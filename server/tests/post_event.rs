use std::net::SocketAddr;

use sentori_server::router;
use serde_json::json;
use tokio::net::TcpListener;
use uuid::Uuid;

const TOKEN: &str = "st_pk_test01j5y9z3vk8x4rmt2pcq";

async fn spawn() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router::build(router::ServerConfig {
        dev_token: TOKEN.to_string(),
        db: None,
        valkey: None,
        project_id: sentori_server::seed::DEV_PROJECT_ID,
        rate_limit_per_min: 10_000,
        admin_password: "test".to_string(),
        session_secret: "test-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });

    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
    });

    addr
}

fn valid_event() -> serde_json::Value {
    json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-05-09T12:34:56.789Z",
        "kind": "error",
        "platform": "javascript",
        "release": "myapp@1.2.3+456",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17.4" },
        "app": { "version": "1.2.3" },
        "error": {
            "type": "TypeError",
            "message": "test",
            "stack": [{ "file": "a.ts", "line": 1, "inApp": true }]
        }
    })
}

#[tokio::test]
async fn post_valid_event_returns_202() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Sentori-Sdk", "test/0.0.0")
        .json(&valid_event())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 202);
}

#[tokio::test]
async fn missing_token_returns_401() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .json(&valid_event())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn invalid_token_returns_401() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", "Bearer wrong_token")
        .json(&valid_event())
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn payload_too_large_returns_413() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let huge: String = "x".repeat(2 * 1024 * 1024);

    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Content-Type", "application/json")
        .body(huge)
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 413);
}

/// Regression: the attachment POST route raises the body cap to 16 MB
/// for replay NDJSON. Before this was fixed (server tier of rc.10) the
/// outer global RequestBodyLimitLayer cut every body off at 1 MB
/// regardless of the per-route override — Insight 2026-05-18 verify
/// caught 770 KB replays getting 413. Posting a 5 MB body to the
/// attachment endpoint here should NOT return 413; the route is
/// behind ingest-token auth so we expect 401 (token mismatch) when
/// the body limit no longer pre-empts.
#[tokio::test]
async fn attachment_route_accepts_payloads_above_1mb() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    // Send 5 MB of bytes with a multipart content-type so the request
    // pipeline accepts it like a real upload. We don't need a valid
    // boundary because the body-cap check fires before the multipart
    // parser sees the body.
    let big: Vec<u8> = vec![b'x'; 5 * 1024 * 1024];

    let resp = client
        .post(format!("http://{addr}/v1/events/test-event-id/attachments/replay"))
        .header("Authorization", "Bearer wrong-token-just-to-fail-auth")
        .header("Content-Type", "multipart/form-data; boundary=----test")
        .body(big)
        .send()
        .await
        .unwrap();

    // The interesting assertion is "not 413". Auth failure (401) is
    // the expected outcome since our bogus token doesn't match.
    assert_ne!(resp.status(), 413, "5 MB body got 413; outer body cap is still squeezing the per-route override");
}

#[tokio::test]
async fn invalid_json_returns_400() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Content-Type", "application/json")
        .body("{ not valid json")
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn batch_accepts_valid_rejects_invalid() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let valid = valid_event();
    let invalid = json!({ "id": "not a uuid", "kind": "error" });

    let resp = client
        .post(format!("http://{addr}/v1/events:batch"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&json!({ "events": [valid, invalid] }))
        .send()
        .await
        .unwrap();

    assert_eq!(resp.status(), 202);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["accepted"], 1);
    assert_eq!(body["rejected"], 1);
}

#[tokio::test]
async fn recent_returns_pushed_events() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("http://{addr}/v1/events/_recent"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let events: Vec<serde_json::Value> = resp.json().await.unwrap();
    assert!(events.is_empty());

    let posted = valid_event();
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&posted)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 202);

    let resp = client
        .get(format!("http://{addr}/v1/events/_recent"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    let events: Vec<serde_json::Value> = resp.json().await.unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["id"], posted["id"]);
}

#[tokio::test]
async fn recent_requires_auth() {
    let addr = spawn().await;
    let client = reqwest::Client::new();

    let resp = client
        .get(format!("http://{addr}/v1/events/_recent"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 401);
}
