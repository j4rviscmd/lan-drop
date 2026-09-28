//! SSE event broadcast through the real router (no Tauri), plus the
//! pull-destination naming helper.

use axum::{body::Body, http::Request};
use lan_drop_lib::server;
use tokio_stream::StreamExt as _;
use tower::ServiceExt;

fn temp_root(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("lan-drop-it-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[tokio::test]
async fn events_stream_carries_emitted_transfers() {
    let root = temp_root("sse");
    let (tx, _keep) = tokio::sync::broadcast::channel(4);
    let app = server::router(server::new_state(tx.clone(), root.join("lan-drop")).unwrap());

    let resp = app
        .oneshot(Request::get("/api/events").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert!(resp.status().is_success());

    // The handler subscribed when the response started, so an emit now must
    // arrive on the stream.
    server::emit(
        &tx,
        "upload-progress",
        serde_json::json!({ "file": "a.jpg", "received": 1, "total": 2 }),
    );
    let chunk = resp
        .into_body()
        .into_data_stream()
        .next()
        .await
        .expect("sse stream ended")
        .expect("sse chunk error");
    let text = String::from_utf8_lossy(&chunk);
    assert!(text.contains("event: upload-progress"), "got: {text}");
    assert!(text.contains("\"file\":\"a.jpg\""), "got: {text}");
}

#[tokio::test]
async fn unique_path_suffixes_duplicates() {
    let root = temp_root("uniq");
    std::fs::write(root.join("photo.jpg"), b"x").unwrap();
    let p = server::unique_path(&root, "photo.jpg").await;
    assert_eq!(p.file_name().unwrap(), "photo (1).jpg");
    std::fs::write(&p, b"x").unwrap();
    let p2 = server::unique_path(&root, "photo.jpg").await;
    assert_eq!(p2.file_name().unwrap(), "photo (2).jpg");
}
