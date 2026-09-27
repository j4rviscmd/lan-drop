//! End-to-end HTTP behavior check against the real router (no Tauri):
//! upload→disk, list, download, SSE event broadcast, traversal rejection.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use lan_drop_lib::server;
use tower::ServiceExt;

fn temp_root(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("lan-drop-it-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[tokio::test]
async fn upload_list_download_roundtrip() {
    let root = temp_root("roundtrip");
    let (tx, _keep) = tokio::sync::broadcast::channel(16);
    let mut rx = tx.subscribe();
    let app =
        server::router(server::new_state(tx, root.clone(), root.join("lan-drop"), None).unwrap());

    let body = "--X\r\n\
        Content-Disposition: form-data; name=\"file\"; filename=\"hello.txt\"\r\n\
        Content-Type: text/plain\r\n\r\n\
        hello lan-drop\r\n\
        --X--\r\n";
    let resp = app
        .clone()
        .oneshot(
            Request::post("/api/upload")
                .header("content-type", "multipart/form-data; boundary=X")
                .header("content-length", body.len().to_string())
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        std::fs::read_to_string(root.join("lan-drop").join("hello.txt")).unwrap(),
        "hello lan-drop"
    );

    // upload-done was broadcast on the events channel
    let mut saw_done = false;
    while let Ok(ev) = rx.try_recv() {
        if ev.name == "upload-done" && ev.data.contains("hello.txt") {
            saw_done = true;
        }
    }
    assert!(saw_done, "upload-done event missing");

    let resp = app
        .clone()
        .oneshot(
            Request::get("/api/list?path=lan-drop")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let text = String::from_utf8(
        axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
    .unwrap();
    assert!(text.contains("hello.txt"), "list body: {text}");

    let resp = app
        .clone()
        .oneshot(
            Request::get("/api/download?path=lan-drop/hello.txt")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(resp.headers().contains_key("content-disposition"));
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&bytes[..], b"hello lan-drop");

    // traversal and escape are rejected
    for bad in ["../secret.txt", "lan-drop/../../secret.txt"] {
        let resp = app
            .clone()
            .oneshot(
                Request::get(format!("/api/download?path={}", bad.replace('/', "%2F")))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::FORBIDDEN, "path={bad}");
    }

    // health responds
    let resp = app
        .oneshot(Request::get("/api/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn duplicate_upload_gets_suffixed_name() {
    let root = temp_root("dup");
    let (tx, _keep) = tokio::sync::broadcast::channel(4);
    let app =
        server::router(server::new_state(tx, root.clone(), root.join("lan-drop"), None).unwrap());

    let body = "--X\r\n\
        Content-Disposition: form-data; name=\"file\"; filename=\"a.bin\"\r\n\r\n\
        123\r\n\
        --X--\r\n";
    for _ in 0..2 {
        let resp = app
            .clone()
            .oneshot(
                Request::post("/api/upload")
                    .header("content-type", "multipart/form-data; boundary=X")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
    assert!(root.join("lan-drop").join("a.bin").exists());
    assert!(root.join("lan-drop").join("a (1).bin").exists());
}

#[tokio::test]
async fn upload_over_2mb_succeeds() {
    // axum's DefaultBodyLimit (2 MiB) used to abort large multipart bodies.
    let root = temp_root("big");
    let (tx, _keep) = tokio::sync::broadcast::channel(4);
    let app =
        server::router(server::new_state(tx, root.clone(), root.join("lan-drop"), None).unwrap());

    let payload: Vec<u8> = (0..3 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
    let mut body =
        "--X\r\nContent-Disposition: form-data; name=\"file\"; filename=\"big.bin\"\r\n\r\n"
            .to_string()
            .into_bytes();
    body.extend_from_slice(&payload);
    body.extend_from_slice(b"\r\n--X--\r\n");

    let resp = app
        .oneshot(
            Request::post("/api/upload")
                .header("content-type", "multipart/form-data; boundary=X")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let saved = std::fs::read(root.join("lan-drop").join("big.bin")).unwrap();
    assert_eq!(saved.len(), 3 * 1024 * 1024);
    assert_eq!(saved, payload);
}

#[tokio::test]
async fn aborted_upload_leaves_no_partial_file() {
    let root = temp_root("abort");
    let (tx, _keep) = tokio::sync::broadcast::channel(4);
    let app =
        server::router(server::new_state(tx, root.clone(), root.join("lan-drop"), None).unwrap());

    // multipart body cut off before the closing boundary
    let body = "--X\r\n\
        Content-Disposition: form-data; name=\"file\"; filename=\"cut.bin\"\r\n\r\n\
        partial-bytes";
    let resp = app
        .oneshot(
            Request::post("/api/upload")
                .header("content-type", "multipart/form-data; boundary=X")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let upload_dir = root.join("lan-drop");
    let leftovers: Vec<_> = std::fs::read_dir(&upload_dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        leftovers.is_empty(),
        "aborted upload left files: {leftovers:?}"
    );
}

#[tokio::test]
async fn ca_cert_route_serves_pem_or_404() {
    let root = temp_root("ca");
    let (tx, _keep) = tokio::sync::broadcast::channel(4);
    let pem = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n";
    let app = server::router(
        server::new_state(
            tx,
            root.clone(),
            root.join("lan-drop"),
            Some(pem.to_string()),
        )
        .unwrap(),
    );
    let resp = app
        .clone()
        .oneshot(Request::get("/ca.crt").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(resp.headers()["content-type"], "application/x-x509-ca-cert");
    assert!(resp.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .contains("lan-drop-ca.crt"));
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(&bytes[..], pem.as_bytes());

    let (tx2, _keep2) = tokio::sync::broadcast::channel(4);
    let app2 =
        server::router(server::new_state(tx2, root.clone(), root.join("lan-drop"), None).unwrap());
    let resp = app2
        .oneshot(Request::get("/ca.crt").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
