use std::net::SocketAddr;

use sentori_server::router;
use serde_json::json;
use tokio::net::TcpListener;
use uuid::Uuid;

const TOKEN: &str = "st_pk_test01j5y9z3vk8x4rmt2pcq";

async fn spawn() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router::build(
        TOKEN.to_string(),
        None,
        None,
        sentori_server::seed::DEV_PROJECT_ID,
        10_000,
    );

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
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
