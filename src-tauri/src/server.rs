//! In-process axum HTTP server: web UI for the phone, upload receive,
//! served-folder list/download, and SSE transfer progress.

use std::{convert::Infallible, path::PathBuf, sync::Arc, time::UNIX_EPOCH};

use axum::{
    body::Body,
    extract::{Multipart, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::{io::AsyncWriteExt, sync::broadcast};
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use tokio_util::io::ReaderStream;

/// Emit a progress event at most once per this many bytes received.
pub const PROGRESS_CHUNK: u64 = 1024 * 1024;

pub type ApiResult<T> = Result<T, (StatusCode, String)>;

#[derive(Clone)]
pub struct TransferEvent {
    pub name: String,
    pub data: String,
}

pub struct AppState {
    events: broadcast::Sender<TransferEvent>,
    /// Canonicalized root visible to `GET /api/list` and `GET /api/download`.
    pub serve_root: PathBuf,
    /// Canonicalized destination folder for uploads.
    pub upload_dir: PathBuf,
    /// CA certificate PEM served at `GET /ca.crt` for first-time iPhone setup.
    pub ca_cert_pem: Option<String>,
}

pub fn new_state(
    events: broadcast::Sender<TransferEvent>,
    serve_root: PathBuf,
    upload_dir: PathBuf,
    ca_cert_pem: Option<String>,
) -> std::io::Result<Arc<AppState>> {
    std::fs::create_dir_all(&upload_dir)?;
    Ok(Arc::new(AppState {
        events,
        serve_root: serve_root.canonicalize()?,
        upload_dir: upload_dir.canonicalize()?,
        ca_cert_pem,
    }))
}

/// Bind `addr` on `start`, falling back to the next ports if busy. The
/// returned listener stays bound (so the port is reserved until served) and
/// is set non-blocking — both tokio's `from_std` and axum-server's
/// `from_tcp` require it but neither sets it.
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
    // Permissive CORS: the Tauri webview (http://tauri.localhost) subscribes to
    // /api/events cross-origin. No credentials, LAN-only personal app.
    Router::new()
        .route("/", get(index))
        .route("/ca.crt", get(ca_cert))
        .route("/api/health", get(health))
        .route("/api/list", get(list))
        .route("/api/download", get(download))
        .route("/api/upload", post(upload))
        .route("/api/events", get(events))
        .layer(axum::middleware::from_fn(log_requests))
        // Uploads stream straight to disk; the 2 MiB DefaultBodyLimit would
        // abort every larger transfer. Disk space is the real limit here.
        .layer(axum::extract::DefaultBodyLimit::max(usize::MAX))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

/// Plain-HTTP router for one-time iPhone setup: the phone cannot trust the
/// HTTPS server until the CA is installed, and iOS may refuse the in-flow
/// certificate exception. This serves only the CA and instructions.
pub fn ca_setup_router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(setup_page))
        .route("/ca.crt", get(ca_cert))
        .with_state(state)
}

async fn setup_page() -> Html<&'static str> {
    Html(include_str!("web/setup.html"))
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

async fn ca_cert(State(state): State<Arc<AppState>>) -> ApiResult<Response> {
    let pem = state
        .ca_cert_pem
        .as_deref()
        .ok_or((StatusCode::NOT_FOUND, "no CA configured".into()))?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                "application/x-x509-ca-cert".to_string(),
            ),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"lan-drop-ca.crt\"".to_string(),
            ),
        ],
        pem.to_string(),
    )
        .into_response())
}

async fn index() -> Html<&'static str> {
    Html(include_str!("web/index.html"))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "name": "lan-drop",
        "version": env!("CARGO_PKG_VERSION"),
        "pin_required": false,
    }))
}

#[derive(Deserialize)]
pub struct PathParams {
    pub path: Option<String>,
}

#[derive(Serialize)]
struct Entry {
    name: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

/// Resolve `rel` inside `root`, rejecting traversal and escapes.
fn resolve_under(root: &std::path::Path, rel: &str) -> Result<PathBuf, (StatusCode, String)> {
    let rel = rel.trim_start_matches(['/', '\\']);
    if rel.is_empty() {
        return Ok(root.to_path_buf());
    }
    if rel.split(['/', '\\']).any(|seg| seg == "..") {
        return Err((StatusCode::FORBIDDEN, "path traversal rejected".into()));
    }
    match root.join(rel).canonicalize() {
        Ok(canon) if canon.starts_with(root) => Ok(canon),
        Ok(_) => Err((StatusCode::FORBIDDEN, "path escapes served root".into())),
        Err(_) => Err((StatusCode::NOT_FOUND, "path not found".into())),
    }
}

async fn list(
    State(state): State<Arc<AppState>>,
    Query(params): Query<PathParams>,
) -> ApiResult<Json<Vec<Entry>>> {
    let dir = resolve_under(&state.serve_root, params.path.as_deref().unwrap_or(""))?;
    let mut rd = tokio::fs::read_dir(&dir)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "cannot read directory".into()))?;
    let mut out = Vec::new();
    while let Some(e) = rd.next_entry().await.map_err(server_error)? {
        // Dotfiles hidden: standard file-browser behavior, and it keeps the
        // in-flight ".part" upload temporaries out of the phone's list.
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let md = e.metadata().await.map_err(server_error)?;
        let modified = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        out.push(Entry {
            name: e.file_name().to_string_lossy().into_owned(),
            is_dir: md.is_dir(),
            size: md.len(),
            modified,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Json(out))
}

fn server_error(e: std::io::Error) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

/// Canonical paths carry the Windows verbatim `\\?\` prefix; strip it for
/// anything shown to users. Internal code must keep the canonical form.
pub fn display(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r#"\\?\"#)
        .to_owned()
}

async fn download(
    State(state): State<Arc<AppState>>,
    Query(params): Query<PathParams>,
) -> ApiResult<Response> {
    let path = resolve_under(&state.serve_root, params.path.as_deref().unwrap_or(""))?;
    let md = tokio::fs::metadata(&path)
        .await
        .map_err(|_| (StatusCode::NOT_FOUND, "file not found".into()))?;
    if !md.is_file() {
        return Err((StatusCode::BAD_REQUEST, "not a file".into()));
    }
    let file = tokio::fs::File::open(&path).await.map_err(server_error)?;
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    let utf8: String = name.bytes().map(|b| format!("%{b:02X}")).collect();
    let ascii: String = name
        .chars()
        .map(|c| {
            if c.is_ascii() && !c.is_control() {
                c
            } else {
                '_'
            }
        })
        .collect();
    let stream = ReaderStream::new(file);
    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{utf8}"),
            ),
            (header::CONTENT_LENGTH, md.len().to_string()),
        ],
        Body::from_stream(stream),
    )
        .into_response())
}

async fn upload(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> ApiResult<Json<serde_json::Value>> {
    // Single file per request from the web UI; request Content-Length (multipart
    // framing adds only a few hundred bytes) drives the progress bar.
    let total: u64 = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut received_total: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("bad multipart body: {e}")))?
    {
        let name = sanitize_filename(field.file_name().unwrap_or("file"));
        let dest = unique_path(&state.upload_dir, &name).await;
        // Stream into a temp file and rename on completion, so an aborted
        // upload never leaves a truncated file under its final name.
        let tmp = state.upload_dir.join(format!(
            ".{}.{}.part",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_nanos()),
        ));
        match stream_field_to(
            &mut field,
            &tmp,
            total,
            &mut received_total,
            &mut last_emit,
            &state.events,
            &name,
        )
        .await
        {
            Ok(file_bytes) => {
                tokio::fs::rename(&tmp, &dest).await.map_err(server_error)?;
                emit(
                    &state.events,
                    "upload-done",
                    serde_json::json!({
                        "file": name,
                        "size": file_bytes,
                        "path": display(&dest),
                    }),
                );
            }
            Err(e) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                return Err(e);
            }
        }
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[allow(clippy::too_many_arguments)]
async fn stream_field_to(
    field: &mut axum::extract::multipart::Field<'_>,
    tmp: &std::path::Path,
    total: u64,
    received_total: &mut u64,
    last_emit: &mut u64,
    events: &broadcast::Sender<TransferEvent>,
    name: &str,
) -> ApiResult<u64> {
    let mut file = tokio::fs::File::create(tmp).await.map_err(server_error)?;
    let mut file_bytes: u64 = 0;
    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("bad multipart body: {e}")))?
    {
        file.write_all(&chunk).await.map_err(server_error)?;
        file_bytes += chunk.len() as u64;
        *received_total += chunk.len() as u64;
        if total > 0 && *received_total - *last_emit >= PROGRESS_CHUNK {
            *last_emit = *received_total;
            emit(
                events,
                "upload-progress",
                serde_json::json!({ "file": name, "received": file_bytes, "total": total }),
            );
        }
    }
    file.flush().await.map_err(server_error)?;
    Ok(file_bytes)
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

    #[test]
    fn resolve_rejects_traversal() {
        let tmp = std::env::temp_dir().join(format!("lan-drop-resolve-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let root = tmp.canonicalize().unwrap();
        assert!(resolve_under(&root, "../x").is_err());
        assert!(resolve_under(&root, "a/../../x").is_err());
        assert_eq!(resolve_under(&root, "").unwrap(), root);
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
