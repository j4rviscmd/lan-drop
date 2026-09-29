pub mod server;
pub mod settings;
pub mod usb;

use serde::Serialize;
use tauri::Manager;

// Why: 8788 is not a leftover of the removed `LAN 8787 + 1` scheme — the
// loopback listener already lived there, so the port survives the LAN removal.
const LOOPBACK_PORT: u16 = 8788;

#[derive(Serialize, Clone)]
struct ServerInfo {
    /// Loopback plain-HTTP port for the desktop webview's EventSource.
    loopback_port: u16,
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

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let settings = settings::load(&data_dir, default_upload_dir.clone());

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
            let state = server::new_state(events, upload_dir)?;
            // set_upload_dir / server_info reach the live state from commands.
            app.manage(state.clone());
            app.manage(usb_events);
            let upload_dir_disp = server::display(&state.upload_dir());
            let loopback_router = server::router(state);

            // Plain-HTTP loopback listener serving SSE transfer progress to
            // the desktop webview. Loopback only: no firewall prompt, no
            // mixed-content concerns for EventSource.
            let lb_listener = server::bind_with_fallback("127.0.0.1", LOOPBACK_PORT)?;
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
            println!("lan-drop loopback events on http://127.0.0.1:{loopback_port}");
            // Startup reveal: config creates the window hidden+maximized so
            // nothing paints at the 1080x720 default; once startup is done,
            // show the fully rendered maximized window and take foreground
            // focus (Windows can leave it behind the foreground app).
            // Note: reveal errors are swallowed — a failed show/focus must
            // not abort startup setup.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
            app.manage(ServerInfo {
                loopback_port,
                upload_dir: upload_dir_disp,
            });
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        // Startup auto-update (frontend: AppUpdateInitializer). Registered
        // unconditionally — public release manifest, no build-time secrets,
        // and it keeps the updater:* capability resolvable in dev too.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
