pub mod server;
pub mod settings;
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
    upload_dir: String,
}

#[tauri::command]
fn server_info(
    info: tauri::State<ServerInfo>,
    state: tauri::State<'_, std::sync::Arc<server::AppState>>,
) -> ServerInfo {
    let mut info = info.inner().clone();
    // Live value: set_upload_dir swaps the folder at runtime.
    info.upload_dir = server::display(&state.upload_dir());
    info
}

/// Switch the upload destination at runtime. Validate (create + canonicalize)
/// and persist first, then point the live server state at it — a failed save
/// leaves everything unchanged.
#[tauri::command]
fn set_upload_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<server::AppState>>,
    path: String,
) -> Result<String, String> {
    let path = std::path::PathBuf::from(path);
    std::fs::create_dir_all(&path).map_err(|e| format!("can't create folder: {e}"))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("can't open folder: {e}"))?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    // Note: persist the path as chosen (not canonicalized) so config.json
    // stays human-readable; only the live state takes the canonical form.
    settings::save(&data_dir, &settings::Settings { upload_dir: path })
        .map_err(|e| format!("can't save settings: {e}"))?;
    state.set_upload_dir(canonical.clone());
    Ok(server::display(&canonical))
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
            // Debug-only registration of the MCP bridge (see the desktop
            // target dep in Cargo.toml): lets AI tools drive and inspect the
            // running app (webview automation, IPC capture, screenshots).
            // This cfg is the real debug gate — release never registers the
            // plugin, so no WS server ships. Requires withGlobalTauri in
            // tauri.conf.json (the bridge's injected JS reads
            // window.__TAURI__); that flag is global and ships in release
            // too — accepted: __TAURI_INTERNALS__ exists in every Tauri
            // page anyway and commands stay capability-gated.
            // CAUTION: bind loopback only. The plugin's default 0.0.0.0 bind
            // triggers a Windows Firewall prompt on every `tauri dev` launch
            // (per-exe-path, so each worktree re-prompts). The MCP client
            // connects from the same machine, so loopback is sufficient.
            #[cfg(all(not(mobile), debug_assertions))]
            {
                app.handle()
                    .plugin(tauri_plugin_mcp_bridge::init_with_config(
                        tauri_plugin_mcp_bridge::Config::localhost_only(),
                    ))
                    .expect("Failed to register mcp-bridge plugin");
            }

            let home = app.path().home_dir()?;
            let default_upload_dir = home.join("Downloads").join("lan-drop");

            // Local CA: generated once, installed on the iPhone once, then
            // every leaf we serve is trusted without browser warnings.
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let settings = settings::load(&data_dir, default_upload_dir.clone());
            let ca = tls::Ca::load_or_create(&data_dir)?;

            // TODO: multi-adapter (VPN) machines may pick the wrong IP; pick from a list later
            let ip = local_ip_address::local_ip().unwrap_or(std::net::Ipv4Addr::LOCALHOST.into());

            let (events, _keep) = tokio::sync::broadcast::channel(64);
            let usb_events = events.clone();
            // Configured folder unusable (unplugged drive, permissions…):
            // fall back to the default rather than refuse to start. The
            // saved choice stays, so it's honored again once usable.
            let upload_dir = settings.upload_dir.canonicalize().unwrap_or_else(|e| {
                eprintln!(
                    "lan-drop: configured upload dir {} unusable ({e}), using default",
                    server::display(&settings.upload_dir)
                );
                default_upload_dir
            });
            let state = server::new_state(events, upload_dir, Some(ca.cert_pem.clone()))?;
            // set_upload_dir / server_info reach the live state from commands.
            app.manage(state.clone());
            app.manage(usb_events);
            let upload_dir_disp = server::display(&state.upload_dir());
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

            // Device-set watcher: pushes usbmuxd changes to the webview as
            // the "usb-devices" event (the frontend never polls usbmuxd).
            tauri::async_runtime::spawn(usb::watch_devices(app.handle().clone()));
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
                upload_dir: upload_dir_disp,
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            server_info,
            set_upload_dir,
            usb::usb_devices,
            usb::usb_pair,
            usb::usb_device_info,
            usb::usb_list,
            usb::usb_pull,
            usb::usb_apps,
            usb::usb_push,
            usb::usb_thumbnail,
            usb::usb_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
