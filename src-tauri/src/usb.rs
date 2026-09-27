//! USB mode: talk to the iPhone over Apple's own stack (usbmuxd → lockdown →
//! AFC), Filey-style. Requires Apple Mobile Device Service (iTunes or the
//! "Apple Devices" Microsoft Store app) to provide usbmuxd on Windows, and a
//! one-time USB pairing with the device unlocked. After that, file transfer
//! involves no browser, no certificates, and no iOS permissions.
//!
//! Scope: the media partition via `com.apple.afc` — full read access
//! (DCIM camera roll, Recordings, Books, …) and write access to the partition
//! root (PC↔PC "USB stick" usage). Writing into the Photos library is not
//! possible through AFC.

use idevice::{
    provider::IdeviceProvider,
    services::{
        afc::{opcode::AfcFopenMode, AfcClient},
        lockdown::LockdownClient,
    },
    usbmuxd::{UsbmuxdAddr, UsbmuxdConnection, UsbmuxdDevice},
    IdeviceService,
};
use serde::Serialize;
use tauri::Manager;

use crate::server;

const LABEL: &str = "lan-drop";
/// Chunk size for both directions; AFC packets carry it fine and it keeps
/// progress events at a sensible rate.
const CHUNK: usize = 1024 * 1024;

fn es(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// usbmuxd lives at 127.0.0.1:27015 on Windows (Apple Mobile Device Service).
fn mux_addr() -> Result<UsbmuxdAddr, String> {
    if let Ok(addr) = UsbmuxdAddr::from_env_var() {
        return Ok(addr);
    }
    let addr: std::net::SocketAddr = "127.0.0.1:27015"
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    Ok(UsbmuxdAddr::TcpSocket(addr))
}

async fn mux() -> Result<UsbmuxdConnection, String> {
    mux_addr()?.connect(0).await.map_err(|e| {
        format!("cannot reach usbmuxd (is iTunes or the Apple Devices app installed?): {e}")
    })
}

async fn device(udid: &str) -> Result<(UsbmuxdDevice, UsbmuxdAddr), String> {
    let addr = mux_addr()?;
    let mut mux = addr.connect(0).await.map_err(es)?;
    let dev = mux
        .get_device(udid)
        .await
        .map_err(|e| format!("device {udid} not connected: {e}"))?;
    Ok((dev, addr))
}

/// Stable host identity for the pairing record, persisted in the app data dir.
fn host_id(app: &tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("host_id");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            return Ok(id);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    std::fs::write(&path, &id).map_err(es)?;
    Ok(id)
}

#[derive(Serialize)]
pub struct UsbDeviceEntry {
    pub udid: String,
    pub connection: String,
}

#[tauri::command]
pub async fn usb_devices() -> Result<Vec<UsbDeviceEntry>, String> {
    let mut mux = mux().await?;
    let devs = mux.get_devices().await.map_err(es)?;
    Ok(devs
        .into_iter()
        .map(|d| UsbDeviceEntry {
            udid: d.udid,
            connection: format!("{:?}", d.connection_type),
        })
        .collect())
}

/// Pair with the device. The iPhone must be unlocked; the user taps "Trust"
/// while this runs (the call blocks on the dialog).
#[tauri::command]
pub async fn usb_pair(app: tauri::AppHandle, udid: String) -> Result<(), String> {
    let mut mux = mux().await?;
    let dev = mux.get_device(&udid).await.map_err(es)?;
    let addr = mux_addr()?;
    let provider = dev.to_provider(addr, LABEL);
    let mut lockdown = LockdownClient::connect(&provider).await.map_err(es)?;

    let buid = mux.get_buid().await.map_err(es)?;
    let record = lockdown
        .pair(host_id(&app)?, buid, Some("lan-drop"))
        .await
        .map_err(es)?;
    let bytes = record.serialize().map_err(es)?;
    mux.save_pair_record(&udid, bytes).await.map_err(es)?;
    Ok(())
}

#[derive(Serialize)]
pub struct UsbDeviceInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub async fn usb_device_info(udid: String) -> Result<UsbDeviceInfo, String> {
    let (dev, addr) = device(&udid).await?;
    let provider = dev.to_provider(addr, LABEL);
    let mut lockdown = LockdownClient::connect(&provider).await.map_err(es)?;
    let pairing = provider.get_pairing_file().await.map_err(es)?;
    lockdown.start_session(&pairing).await.map_err(es)?;
    let name = lockdown
        .get_value(Some("DeviceName"), None)
        .await
        .ok()
        .and_then(|v| v.as_string().map(str::to_string))
        .unwrap_or_else(|| "iPhone".into());
    let version = lockdown
        .get_value(Some("ProductVersion"), None)
        .await
        .ok()
        .and_then(|v| v.as_string().map(str::to_string))
        .unwrap_or_default();
    Ok(UsbDeviceInfo { name, version })
}

#[derive(Serialize)]
pub struct UsbEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[tauri::command]
pub async fn usb_list(udid: String, path: String) -> Result<Vec<UsbEntry>, String> {
    let mut afc = afc_client(&udid).await?;
    let names = afc.list_dir(&path).await.map_err(es)?;
    let mut out = Vec::new();
    for name in names {
        if name == "." || name == ".." {
            continue;
        }
        let full = format!("{}/{}", path.trim_end_matches('/'), name);
        match afc.get_file_info(&full).await {
            Ok(info) => out.push(UsbEntry {
                is_dir: info.st_ifmt == "S_IFDIR",
                size: info.size as u64,
                name,
            }),
            Err(_) => continue,
        }
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

async fn afc_client(udid: &str) -> Result<AfcClient, String> {
    let (dev, addr) = device(udid).await?;
    let provider = dev.to_provider(addr, LABEL);
    AfcClient::connect(&provider).await.map_err(es)
}

/// Copy a file from the device into `dest_dir` (the app's Downloads folder).
#[tauri::command]
pub async fn usb_pull(
    events: tauri::State<'_, tokio::sync::broadcast::Sender<server::TransferEvent>>,
    udid: String,
    path: String,
    dest_dir: String,
) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;

    let name = path.rsplit('/').next().unwrap_or("file").to_string();
    let mut afc = afc_client(&udid).await?;
    let info = afc.get_file_info(&path).await.map_err(es)?;
    let total = info.size as u64;
    let dest_dir = std::path::PathBuf::from(dest_dir);
    let dest = server::unique_path(&dest_dir, &server::sanitize_filename(&name)).await;

    let mut fd = afc.open(&path, AfcFopenMode::RdOnly).await.map_err(es)?;
    let mut out = tokio::fs::File::create(&dest).await.map_err(es)?;
    let mut got: u64 = 0;
    let mut last_emit: u64 = 0;
    while got < total {
        let want = CHUNK.min((total - got) as usize);
        let chunk = fd.read_n(want).await.map_err(es)?;
        if chunk.is_empty() {
            break;
        }
        out.write_all(&chunk).await.map_err(es)?;
        got += chunk.len() as u64;
        if got - last_emit >= server::PROGRESS_CHUNK {
            last_emit = got;
            server::emit(
                events.inner(),
                "upload-progress",
                serde_json::json!({ "file": name, "received": got, "total": total }),
            );
        }
    }
    out.flush().await.map_err(es)?;
    drop(out);
    fd.close().await.map_err(es)?;
    server::emit(
        events.inner(),
        "upload-done",
        serde_json::json!({
            "file": name,
            "size": got,
            "path": server::display(&dest),
        }),
    );
    Ok(server::display(&dest))
}

/// Copy a PC file onto the device under `afc_dir`.
#[tauri::command]
pub async fn usb_push(
    events: tauri::State<'_, tokio::sync::broadcast::Sender<server::TransferEvent>>,
    udid: String,
    src: String,
    afc_dir: String,
) -> Result<(), String> {
    use tokio::io::AsyncReadExt;

    let meta = tokio::fs::metadata(&src).await.map_err(es)?;
    let total = meta.len();
    let name = server::sanitize_filename(
        std::path::Path::new(&src)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .as_deref()
            .unwrap_or("file"),
    );

    let mut afc = afc_client(&udid).await?;
    let _ = afc.mk_dir(&afc_dir).await; // exists is fine
    let target = format!("{}/{}", afc_dir.trim_end_matches('/'), name);
    let mut fd = afc.open(&target, AfcFopenMode::WrOnly).await.map_err(es)?;

    let mut file = tokio::fs::File::open(&src).await.map_err(es)?;
    let mut buf = vec![0u8; CHUNK];
    let mut sent: u64 = 0;
    let mut last_emit: u64 = 0;
    loop {
        let n = file.read(&mut buf).await.map_err(es)?;
        if n == 0 {
            break;
        }
        fd.write_entire(&buf[..n]).await.map_err(es)?;
        sent += n as u64;
        if sent - last_emit >= server::PROGRESS_CHUNK {
            last_emit = sent;
            server::emit(
                events.inner(),
                "upload-progress",
                serde_json::json!({ "file": name, "received": sent, "total": total }),
            );
        }
    }
    fd.close().await.map_err(es)?;
    server::emit(
        events.inner(),
        "upload-done",
        serde_json::json!({
            "file": name,
            "size": sent,
            "path": target,
        }),
    );
    Ok(())
}
