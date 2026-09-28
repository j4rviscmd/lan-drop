//! Loopback axum server: SSE transfer-progress events for the desktop
//! webview. USB pull/push reports progress through `emit` on the same
//! broadcast channel the SSE endpoint streams.

use std::{convert::Infallible, path::PathBuf, sync::Arc};

use axum::{
    extract::State,
    response::{
        sse::{Event, KeepAlive, Sse},
        Response,
    },
    routing::get,
    Router,
};
use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};

/// Emit a progress event at most once per this many bytes received.
pub const PROGRESS_CHUNK: u64 = 1024 * 1024;

#[derive(Clone)]
pub struct TransferEvent {
    pub name: String,
    pub data: String,
}

pub struct AppState {
    events: broadcast::Sender<TransferEvent>,
    /// Canonicalized destination folder for incoming files; swapped in place
    /// at runtime by `set_upload_dir`. RwLock, not a plain field: the state
    /// outlives every command and USB pull that reads it.
    pub upload_dir: parking_lot::RwLock<PathBuf>,
}

pub fn new_state(
    events: broadcast::Sender<TransferEvent>,
    upload_dir: PathBuf,
) -> std::io::Result<Arc<AppState>> {
    std::fs::create_dir_all(&upload_dir)?;
    Ok(Arc::new(AppState {
        events,
        upload_dir: parking_lot::RwLock::new(upload_dir.canonicalize()?),
    }))
}

impl AppState {
    /// Current canonicalized upload destination.
    pub fn upload_dir(&self) -> PathBuf {
        self.upload_dir.read().clone()
    }

    pub fn set_upload_dir(&self, dir: PathBuf) {
        *self.upload_dir.write() = dir;
    }
}

/// Bind `addr` on `start`, falling back to the next ports if busy. The
/// returned listener stays bound (so the port is reserved until served) and
/// is set non-blocking — tokio's `from_std` requires it but doesn't set it.
pub fn bind_with_fallback(addr: &str, start: u16) -> std::io::Result<std::net::TcpListener> {
    let mut last_err = None;
    for port in start..start + 10 {
        match std::net::TcpListener::bind((addr, port)) {
            Ok(listener) => {
                listener.set_nonblocking(true)?;
                return Ok(listener);
            }
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| {
        std::io::Error::other(format!("no free port in {start}..{}", start + 10))
    }))
}

pub fn router(state: Arc<AppState>) -> Router {
    // Permissive CORS: the Tauri webview (http://tauri.localhost) subscribes
    // to /api/events cross-origin. No credentials, local-only personal app.
    Router::new()
        .route("/api/events", get(events))
        .layer(axum::middleware::from_fn(log_requests))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

/// Request log for debugging from a console (`tauri dev`); invisible in the
/// windowed release build. Not telemetry — local stdout only.
async fn log_requests(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let resp = next.run(req).await;
    eprintln!("lan-drop: {method} {uri} -> {}", resp.status());
    resp
}

/// Canonical paths carry the Windows verbatim `\\?\` prefix; strip it for
/// anything shown to users. Internal code must keep the canonical form.
pub fn display(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r#"\\?\"#)
        .to_owned()
}

async fn events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.events.subscribe()).filter_map(|msg| {
        let ev = msg.ok()?;
        Some(Ok(Event::default().event(ev.name).data(ev.data)))
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

pub fn emit(tx: &broadcast::Sender<TransferEvent>, name: &str, data: serde_json::Value) {
    // Send errors (no subscribers / lagged) are fine: SSE is best-effort.
    let _ = tx.send(TransferEvent {
        name: name.to_string(),
        data: data.to_string(),
    });
}

/// Keep only the file name, replace Windows-reserved characters, drop trailing
/// dots/spaces (invalid on NTFS).
pub fn sanitize_filename(raw: &str) -> String {
    let name = raw
        .rsplit(['/', '\\'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("file");
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        "file".to_string()
    } else {
        trimmed.to_string()
    }
}

/// `photo.jpg` → `photo (1).jpg` if the destination already exists.
pub async fn unique_path(dir: &std::path::Path, name: &str) -> PathBuf {
    let base = dir.join(name);
    if !tokio::fs::try_exists(&base).await.unwrap_or(false) {
        return base;
    }
    let stem = std::path::Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string());
    let ext = std::path::Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 1..1000u32 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return candidate;
        }
    }
    dir.join(format!("{}-{name}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_paths_and_reserved_chars() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("a<b>c:d\"e|f?g*h"), "a_b_c_d_e_f_g_h");
        assert_eq!(sanitize_filename("trailing... "), "trailing");
        assert_eq!(sanitize_filename(""), "file");
        assert_eq!(sanitize_filename("dir/"), "file");
    }
}
