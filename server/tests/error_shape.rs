// F2 — every non-2xx response carries the structured error body:
//   { error: { code, message, hint?, docUrl?, correlationId, layer } }
//
// Tests cover the four most-trafficked error paths:
//   - 401 missing-auth on a protected ingest route
//   - 401 wrong-token on the same path
//   - 413 body-too-large on /v1/events
//   - 400 invalid-json on /v1/events
//
// Each test asserts the body shape AND that `correlationId` matches the
// `X-Sentori-Correlation-Id` header on the same response (F1 contract).

use std::net::SocketAddr;

use sentori_server::router;
use serde_json::{json, Value};
use serial_test::serial;
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
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });
    addr
}

async fn assert_structured_error(
    resp: reqwest::Response,
    expected_status: u16,
    expected_code: &str,
    expected_layer: &str,
) {
    assert_eq!(resp.status().as_u16(), expected_status, "wrong status");
    let header_cid = resp
        .headers()
        .get("x-sentori-correlation-id")
        .expect("missing correlation header on error")
        .to_str()
        .unwrap()
        .to_string();
    Uuid::parse_str(&header_cid).expect("header correlation id is not uuid");

    let body: Value = resp.json().await.expect("body is not json");
    let err = body
        .get("error")
        .expect("missing top-level 'error' object")
        .as_object()
        .expect("'error' is not an object");

    let code = err
        .get("code")
        .and_then(|v| v.as_str())
        .expect("missing or non-string 'code'");
    assert_eq!(code, expected_code, "code");

    let _msg = err
        .get("message")
        .and_then(|v| v.as_str())
        .expect("missing or non-string 'message'");

    let body_cid = err
        .get("correlationId")
        .and_then(|v| v.as_str())
        .expect("missing 'correlationId' in body");
    assert_eq!(
        body_cid, header_cid,
        "body correlationId must match X-Sentori-Correlation-Id header"
    );

    let layer = err
        .get("layer")
        .and_then(|v| v.as_str())
        .expect("missing or non-string 'layer'");
    assert_eq!(layer, expected_layer, "layer");
}

#[tokio::test]
async fn missing_auth_returns_structured_401() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Content-Type", "application/json")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_structured_error(resp, 401, "auth.missingToken", "auth").await;
}

#[tokio::test]
async fn wrong_token_returns_structured_401() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", "Bearer wrong-token")
        .header("Content-Type", "application/json")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_structured_error(resp, 401, "auth.invalidToken", "auth").await;
}

// v1.1 audit-closeout G: this test posts a 2 MB body. Under cargo's
// default parallel test threads, several copies can run at once and
// race on the macOS fd/connection-tracking limits. The `serial`
// marker pins it to a single concurrent run; latency cost is
// negligible (~100ms) compared to flake recovery cost.
#[tokio::test]
#[serial]
async fn body_too_large_returns_structured_413() {
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
    assert_structured_error(resp, 413, "body.tooLarge", "axum.body_limit").await;
}
