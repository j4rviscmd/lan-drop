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
        house_arrest::HouseArrestClient,
        installation_proxy::InstallationProxyClient,
        lockdown::LockdownClient,
    },
    usbmuxd::{UsbmuxdAddr, UsbmuxdConnection, UsbmuxdDevice},
    IdeviceService,
};
use serde::Serialize;
use tauri::{Emitter, Manager};

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

// Why: PartialEq lets watch_devices diff consecutive polls and emit only on change.
#[derive(Serialize, PartialEq)]
pub struct UsbDeviceEntry {
    pub udid: String,
    pub connection: String,
}

/// Event carrying the usbmuxd device set; emitted only when the set changes.
pub const DEVICES_EVENT: &str = "usb-devices";

/// The device set as usbmuxd sees it right now.
async fn list_devices() -> Result<Vec<UsbDeviceEntry>, String> {
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

#[tauri::command]
pub async fn usb_devices() -> Result<Vec<UsbDeviceEntry>, String> {
    list_devices().await
}

/// Watch usbmuxd and push the device set to the webview only when it
/// changes — the datasource layer owns polling, the frontend only reacts.
/// A failed poll keeps the last set: usbmuxd restarting must not read as
/// "device unplugged".
pub async fn watch_devices(app: tauri::AppHandle) {
    // First tick fires immediately, so the current set is pushed at startup.
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(3));
    let mut last: Option<Vec<UsbDeviceEntry>> = None;
    loop {
        interval.tick().await;
        let devs = match list_devices().await {
            Ok(d) => d,
            Err(e) => {
                eprintln!("lan-drop: device watch error: {e}");
                continue;
            }
        };
        if last.as_deref() != Some(devs.as_slice()) {
            if let Err(e) = app.emit(DEVICES_EVENT, &devs) {
                eprintln!("lan-drop: device event error: {e}");
            }
            last = Some(devs);
        }
    }
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
pub async fn usb_list(
    udid: String,
    path: String,
    app: Option<String>,
) -> Result<Vec<UsbEntry>, String> {
    let mut afc = afc_client_for(&udid, app.as_deref()).await?;
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

/// AFC for an app when `app` is a bundle_id, else the media partition.
/// VendDocuments (what iTunes file sharing shows) is the only flavor modern
/// iOS vends to third-party hosts — VendContainer answers
/// InstallationLookupFailed since iOS 8.3. The session still roots at the app
/// container: only the /Documents subtree is readable, so app-scope paths
/// from the UI must be prefixed /Documents.
async fn afc_client_for(udid: &str, app: Option<&str>) -> Result<AfcClient, String> {
    match app {
        None => afc_client(udid).await,
        Some(bundle_id) => {
            let (dev, addr) = device(udid).await?;
            let provider = dev.to_provider(addr, LABEL);
            HouseArrestClient::connect(&provider)
                .await
                .map_err(es)?
                .vend_documents(bundle_id)
                .await
                .map_err(|e| {
                    format!("app documents not accessible (the app must allow file access): {e}")
                })
        }
    }
}

#[derive(Serialize)]
pub struct UsbApp {
    pub bundle_id: String,
    pub name: String,
}

/// User-installed apps — the browser's initial view.
#[tauri::command]
pub async fn usb_apps(udid: String) -> Result<Vec<UsbApp>, String> {
    let (dev, addr) = device(&udid).await?;
    let provider = dev.to_provider(addr, LABEL);
    let mut proxy = InstallationProxyClient::connect(&provider)
        .await
        .map_err(es)?;
    let apps = proxy.get_apps(Some("User"), None).await.map_err(es)?;
    let mut out: Vec<UsbApp> = apps
        .into_iter()
        .map(|(bundle_id, info)| UsbApp {
            name: info
                .as_dictionary()
                .and_then(|d| {
                    d.get("CFBundleDisplayName")
                        .or_else(|| d.get("CFBundleName"))
                })
                .and_then(|v| v.as_string())
                .unwrap_or(&bundle_id)
                .to_string(),
            bundle_id,
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Copy a file from the device into `dest_dir` (the app's Downloads folder).
#[tauri::command]
pub async fn usb_pull(
    events: tauri::State<'_, tokio::sync::broadcast::Sender<server::TransferEvent>>,
    udid: String,
    path: String,
    app: Option<String>,
    dest_dir: String,
) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;

    let name = path.rsplit('/').next().unwrap_or("file").to_string();
    let mut afc = afc_client_for(&udid, app.as_deref()).await?;
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
            // PC-initiated pull: the UI toasts "Saved to …" itself, so the
            // SSE consumer must not add a second "Received" toast.
            "local": true,
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
    app: Option<String>,
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

    let mut afc = afc_client_for(&udid, app.as_deref()).await?;
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
            // PC-initiated push: the UI toasts "Sent …" itself, so the SSE
            // consumer must not add a bogus "Received" toast.
            "local": true,
        }),
    );
    Ok(())
}

/// How much of a file's head to read when looking for an EXIF thumbnail.
/// The APP1/Exif segment sits right after the JPEG SOI marker, so 128 KiB
/// is far more than any camera writes before the pixel data starts.
const THUMB_HEAD: usize = 128 * 1024;

/// Embedded EXIF thumbnail of a JPEG on the device, as a base64 data URL.
/// `Ok(None)` = no usable embedded thumbnail (caller shows a type icon).
// ponytail: JPEG EXIF only — HEIC thumbnails need a HEVC decode (Windows
// codec); UI falls back to type icons. Add HEIC if the camera roll is
// high-efficiency-first and icons feel lacking.
#[tauri::command]
pub async fn usb_thumbnail(
    udid: String,
    path: String,
    app: Option<String>,
) -> Result<Option<String>, String> {
    let mut afc = afc_client_for(&udid, app.as_deref()).await?;
    let mut fd = afc.open(&path, AfcFopenMode::RdOnly).await.map_err(es)?;
    let head = fd.read_n(THUMB_HEAD).await.map_err(es)?;
    fd.close().await.map_err(es)?;
    Ok(exif_thumbnail(&head).map(|j| format!("data:image/jpeg;base64,{}", b64_encode(j))))
}

/// Find the IFD1 (thumbnail) JPEG inside a JPEG blob's APP1/Exif segment.
fn exif_thumbnail(jpg: &[u8]) -> Option<&[u8]> {
    if jpg.get(0..2) != Some(&[0xff, 0xd8][..]) {
        return None; // not a JPEG
    }
    let mut i = 2;
    while i + 4 <= jpg.len() {
        if jpg[i] != 0xff {
            return None; // lost segment sync
        }
        let marker = jpg[i + 1];
        if matches!(marker, 0x01 | 0xd8 | 0xd9 | 0xda) {
            return None; // reached padding/SOI/EOI/SOS without an Exif APP1
        }
        let seg = u16::from_be_bytes([jpg[i + 2], jpg[i + 3]]) as usize;
        if seg < 2 || i + 2 + seg > jpg.len() {
            return None; // corrupt length
        }
        if marker == 0xe1 && jpg.get(i + 4..i + 10) == Some(&b"Exif\0\0"[..]) {
            // TIFF header starts 6 bytes into the Exif payload.
            return exif_ifd1_thumb(jpg, i + 10);
        }
        i += 2 + seg;
    }
    None
}

/// IFD1 thumbnail via JPEGInterchangeFormat (0x0201) / length (0x0202).
/// Offsets are relative to the TIFF header at `tiff` within the whole blob —
/// the thumbnail bytes may legally spill past the APP1 segment boundary.
fn exif_ifd1_thumb(buf: &[u8], tiff: usize) -> Option<&[u8]> {
    let le = match buf.get(tiff..tiff + 2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let rd16 = |o: usize| -> Option<u16> {
        let s = buf.get(o..o + 2)?;
        Some(if le {
            u16::from_le_bytes([s[0], s[1]])
        } else {
            u16::from_be_bytes([s[0], s[1]])
        })
    };
    let rd32 = |o: usize| -> Option<u32> {
        let s = buf.get(o..o + 4)?;
        Some(if le {
            u32::from_le_bytes([s[0], s[1], s[2], s[3]])
        } else {
            u32::from_be_bytes([s[0], s[1], s[2], s[3]])
        })
    };
    let ifd0 = tiff + rd32(tiff + 4)? as usize;
    let n0 = rd16(ifd0)? as usize;
    let ifd1 = tiff + rd32(ifd0.checked_add(2 + 12 * n0)?)? as usize;
    if ifd1 == tiff {
        return None; // no IFD1
    }
    let n1 = rd16(ifd1)? as usize;
    let (mut off, mut len) = (None, 0usize);
    for k in 0..n1 {
        let e = ifd1.checked_add(2 + 12 * k)?;
        match rd16(e)? {
            0x0201 => off = Some(tiff + rd32(e + 8)? as usize),
            0x0202 => len = rd32(e + 8)? as usize,
            _ => {}
        }
    }
    let off = off?;
    let t = buf.get(off..off.checked_add(len)?)?;
    (t.get(0..2) == Some(&[0xff, 0xd8][..])).then_some(t)
}

/// Standard base64 with padding — encode-only, too small to warrant a crate.
fn b64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let mut b = [0u8; 4];
        b[1..1 + c.len()].copy_from_slice(c);
        let n = u32::from_be_bytes(b);
        out.push(T[n as usize >> 18 & 63] as char);
        out.push(T[n as usize >> 12 & 63] as char);
        out.push(if c.len() > 1 {
            T[n as usize >> 6 & 63] as char
        } else {
            '='
        });
        out.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal JPEG: SOI + APP1(Exif, empty IFD0, IFD1 pointing at a tiny
    /// embedded thumb) + SOS + EOI, in either byte order.
    fn jpg_with_thumb(le: bool) -> Vec<u8> {
        let put16 = |v: u16| if le { v.to_le_bytes() } else { v.to_be_bytes() };
        let put32 = |v: u32| if le { v.to_le_bytes() } else { v.to_be_bytes() };
        let thumb = [0xff, 0xd8, 0x00, 0xff, 0xd9]; // tiny fake JPEG

        let mut tiff = Vec::new();
        tiff.extend_from_slice(if le { b"II" } else { b"MM" });
        tiff.extend_from_slice(&put16(42));
        tiff.extend_from_slice(&put32(8)); // IFD0 at offset 8
        tiff.extend_from_slice(&put16(0)); // IFD0: 0 entries
        let ifd1_off = 14; // 8 (IFD0) + 2 (count) + 0 entries * 12 + 4 (next-IFD field)
        tiff.extend_from_slice(&put32(ifd1_off as u32)); // next IFD = IFD1
        tiff.extend_from_slice(&put16(2)); // IFD1: 2 entries
        let thumb_off = ifd1_off + 2 + 12 * 2 + 4;
        for (tag, val) in [(0x0201u16, thumb_off as u32), (0x0202, thumb.len() as u32)] {
            tiff.extend_from_slice(&put16(tag));
            tiff.extend_from_slice(&put16(4)); // type LONG
            tiff.extend_from_slice(&put32(1)); // count 1
            tiff.extend_from_slice(&put32(val));
        }
        tiff.extend_from_slice(&put32(0)); // no IFD2
        tiff.extend_from_slice(&thumb);

        let mut jpg = vec![0xff, 0xd8];
        jpg.extend_from_slice(&[0xff, 0xe1]);
        jpg.extend_from_slice(&((2 + 6 + tiff.len()) as u16).to_be_bytes()); // JPEG segments are always BE
        jpg.extend_from_slice(b"Exif\0\0");
        jpg.extend_from_slice(&tiff);
        jpg.extend_from_slice(&[0xff, 0xda, 0x00, 0x02, 0x00, 0x00]); // SOS
        jpg.extend_from_slice(&[0xff, 0xd9]); // EOI
        jpg
    }

    #[test]
    fn finds_exif_thumb_both_endians() {
        for le in [true, false] {
            let jpg = jpg_with_thumb(le);
            assert_eq!(
                exif_thumbnail(&jpg),
                Some(&[0xff, 0xd8, 0x00, 0xff, 0xd9][..])
            );
        }
    }

    #[test]
    fn rejects_thumbless_inputs() {
        assert_eq!(exif_thumbnail(b"not a jpeg at all"), None);
        assert_eq!(exif_thumbnail(&[0xff, 0xd8, 0xff, 0xd9]), None);
        assert_eq!(exif_thumbnail(&[]), None);
    }

    #[test]
    fn b64_known_vectors() {
        assert_eq!(b64_encode(b""), "");
        assert_eq!(b64_encode(b"f"), "Zg==");
        assert_eq!(b64_encode(b"fo"), "Zm8=");
        assert_eq!(b64_encode(b"foo"), "Zm9v");
        assert_eq!(b64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(b64_encode(&[0xfb, 0xff, 0xef]), "+//v");
    }
}
