pub mod server;
pub mod tls;
pub mod usb;

use serde::Serialize;
use tauri::Manager;

const DEFAULT_PORT: u16 = 8787;

#[derive(Serialize, Clone)]
struct ServerInfo {
    url: String,
    port: u16,
    /// Loopback plain-HTTP port for the desktop webview's EventSource.
    loopback_port: u16,
    qr_svg: String,
    serve_root: String,
    upload_dir: String,
}

#[tauri::command]
fn server_info(info: tauri::State<ServerInfo>) -> ServerInfo {
    info.inner().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // axum-server builds ServerConfig without a provider; without this the
    // TLS handshake panics per connection. ring over the default aws-lc-rs:
    // iOS Safari connections died between handshake and first request with
    // aws-lc-rs on this Windows build; ring matches the LocalSend-style stack.
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .setup(|app| {
            let home = app.path().home_dir()?;
            // TODO MVP+: configurable served folder (tauri-plugin-dialog)
            let serve_root = home.join("Downloads");
            let upload_dir = serve_root.join("lan-drop");

            // Local CA: generated once, installed on the iPhone once, then
            // every leaf we serve is trusted without browser warnings.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let ca = tls::Ca::load_or_create(&data_dir)?;

            // TODO: multi-adapter (VPN) machines may pick the wrong IP; pick from a list later
            let ip = local_ip_address::local_ip().unwrap_or(std::net::Ipv4Addr::LOCALHOST.into());

            let (events, _keep) = tokio::sync::broadcast::channel(64);
            let usb_events = events.clone();
            let state = server::new_state(
                events,
                serve_root.clone(),
                upload_dir.clone(),
                Some(ca.cert_pem.clone()),
            )?;
            app.manage(usb_events);
            let serve_root_disp = server::display(&state.serve_root);
            let upload_dir_disp = server::display(&state.upload_dir);
            let setup_state = state.clone();
            let router = server::router(state);
            let loopback_router = router.clone();
            let setup_router = server::ca_setup_router(setup_state);

            let lan_listener = server::bind_with_fallback("0.0.0.0", DEFAULT_PORT)?;
            let port = lan_listener.local_addr()?.port();
            let (chain, key) = ca.issue_leaf_pem(ip)?;

            // HTTPS listener for the LAN (phone). Leaf SANs cover the LAN IP,
            // loopback and localhost; re-issued every launch to follow DHCP.
            let tls_config = {
                let mut cfg = (*tauri::async_runtime::block_on(
                    axum_server::tls_rustls::RustlsConfig::from_pem(chain, key.into_bytes()),
                )?
                .get_inner())
                .clone();
                // Why: axum-server advertises h2 in ALPN; iOS Safari failed to
                // parse responses over the negotiated h2 path (curl/node both
                // fine). Serving plain HTTP/1.1 on the LAN is plenty.
                cfg.alpn_protocols = vec![b"http/1.1".to_vec()];
                axum_server::tls_rustls::RustlsConfig::from_config(std::sync::Arc::new(cfg))
            };
            tauri::async_runtime::spawn(async move {
                // Construction needs a Tokio reactor, so it lives here.
                // A dead listener must kill the app: the UI would otherwise
                // keep showing a QR that leads to connection-refused.
                // iOS Safari holds the TLS handshake open (no client Finished)
                // while the user reads the certificate warning; the default
                // 10s handshake timeout killed those connections. 10 minutes.
                let acceptor = axum_server::tls_rustls::RustlsAcceptor::new(tls_config)
                    .handshake_timeout(std::time::Duration::from_secs(600));
                let tls_server = match axum_server::from_tcp(lan_listener) {
                    Ok(s) => s.acceptor(acceptor),
                    Err(e) => {
                        eprintln!("lan-drop: https server setup error: {e}");
                        std::process::exit(1);
                    }
                };
                if let Err(e) = tls_server.serve(router.into_make_service()).await {
                    eprintln!("lan-drop: https server error: {e}");
                    std::process::exit(1);
                }
            });

            // Plain-HTTP LAN listener for one-time iPhone CA setup: iOS may
            // refuse the in-flow certificate exception, so the CA has to be
            // installed before the first HTTPS visit. Serves only /ca.crt and
            // instructions — none of the app.
            let setup_listener = server::bind_with_fallback("0.0.0.0", 8790)?;
            let setup_port = setup_listener.local_addr()?.port();
            let setup_listener = tauri::async_runtime::block_on(async {
                tokio::net::TcpListener::from_std(setup_listener)
            })?;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = axum::serve(setup_listener, setup_router).await {
                    eprintln!("lan-drop: setup server error: {e}");
                    std::process::exit(1);
                }
            });

            // Plain-HTTP loopback listener for the desktop webview, whose
            // certificate store does not trust our CA. Loopback is a secure
            // context, so EventSource works without mixed-content issues.
            let lb_listener = server::bind_with_fallback("127.0.0.1", port + 1)?;
            let loopback_port = lb_listener.local_addr()?.port();
            let lb_listener = tauri::async_runtime::block_on(async {
                tokio::net::TcpListener::from_std(lb_listener)
            })?;
            tauri::async_runtime::spawn(async move {
                if let Err(e) = axum::serve(lb_listener, loopback_router).await {
                    eprintln!("lan-drop: loopback server error: {e}");
                    std::process::exit(1);
                }
            });
            println!("lan-drop CA setup on http://{ip}:{setup_port}");

            let url = format!("https://{ip}:{port}");
            let code = qrcode::QrCode::new(url.as_bytes())?;
            let qr_svg = code
                .render::<qrcode::render::svg::Color>()
                .min_dimensions(220, 220)
                .build();
            println!("lan-drop listening on {url}");
            app.manage(ServerInfo {
                url,
                port,
                loopback_port,
                qr_svg,
                serve_root: serve_root_disp,
                upload_dir: upload_dir_disp,
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            server_info,
            usb::usb_devices,
            usb::usb_pair,
            usb::usb_device_info,
            usb::usb_list,
            usb::usb_pull,
            usb::usb_push
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
