//! v2.1 W1 — server back-compat regression for v2.0 SDK wire shape.
//!
//! Sentori v2.1 server adds the auto-instrument runtime-metrics
//! endpoint (`/v1/runtime-metrics:batch`) on top of every v2.0
//! surface, plus rollup / partition crons that operate over new
//! tables. The user-facing contract is: **v2.0 SDK requests keep
//! working forever — events, custom metrics, traces, breadcrumbs
//! (including the new `track` breadcrumb type), the lot.**
//!
//! This test file pins that down by posting v2.0-shaped payloads
//! against the v2.1 server and asserting the response is still
//! `202 Accepted`. Failing any case here means v2.1 has accidentally
//! broken backwards compatibility — stop-ship.

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
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });

    addr
}

/// v2.0 SDK message event with the new `level` field. Identical
/// to what `@goliapkg/sentori-react-native@2.0.0` produces from a
/// `sentori.captureMessage('…', { level: 'warning' })` callsite.
#[tokio::test]
async fn v20_sdk_message_event_accepted() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-06-03T00:00:00.000Z",
        "kind": "message",
        "level": "warning",
        "message": "v2.0 SDK message round-trip",
        "platform": "javascript",
        "release": "myapp@2.0.0",
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17.4" },
        "app": { "version": "2.0.0" },
        "tags": { "feature": "checkout" },
    });
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Sentori-Sdk", "react-native/2.0.0")
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        202,
        "v2.0 SDK message event must keep working on v2.1 server"
    );
}

/// v2.0 SDK error event with `track`-type breadcrumbs in the
/// trail — only possible when the SDK has
/// `init.capture.trackAutoBreadcrumb: true`. The v2.0 server gained
/// `BreadcrumbType::Track` (event.rs); this test pins that v2.1
/// still accepts it.
#[tokio::test]
async fn v20_sdk_error_with_track_breadcrumbs_accepted() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "id": Uuid::now_v7().to_string(),
        "timestamp": "2026-06-03T00:00:00.000Z",
        "kind": "error",
        "platform": "javascript",
        "release": "myapp@2.0.0",
        "environment": "prod",
        "device": { "os": "android", "osVersion": "15" },
        "app": { "version": "2.0.0" },
        "error": {
            "type": "TypeError",
            "message": "v2 track-breadcrumb round-trip",
            "stack": [{ "file": "a.ts", "line": 1, "inApp": true }]
        },
        "breadcrumbs": [
            { "type": "track", "timestamp": "2026-06-03T00:00:00.000Z",
              "data": { "name": "demo.journey.step1", "props": { "surface": "onboard" } } },
            { "type": "track", "timestamp": "2026-06-03T00:00:01.000Z",
              "data": { "name": "demo.journey.step2", "props": { "surface": "paywall" } } },
            { "type": "user", "timestamp": "2026-06-03T00:00:02.000Z",
              "data": { "message": "clicked Buy" } }
        ]
    });
    let resp = client
        .post(format!("http://{addr}/v1/events"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Sentori-Sdk", "react-native/2.0.0")
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        202,
        "v2.0 SDK error event with track-type breadcrumbs must keep working"
    );
}

/// v0.8.3 + v2.0 custom metric path via /v1/metrics:batch. v2.1
/// adds a *sibling* endpoint at /v1/runtime-metrics:batch but
/// does NOT touch this one — the recordMetric path keeps working
/// unchanged, both with and without the v2.0 `tags.span_id`
/// parent-correlation tag added in W3.
#[tokio::test]
async fn v20_sdk_recordmetric_batch_accepted() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "metrics": [
            { "name": "db.users.row_count", "value": 42.0,
              "tags": { "span_id": "span_abc", "trace_id": "trace_xyz" } },
            { "name": "db.users.duration_ms", "value": 12.5,
              "tags": { "span_id": "span_abc", "trace_id": "trace_xyz" } },
            { "name": "cart.size", "value": 5.0 }
        ]
    });
    let resp = client
        .post(format!("http://{addr}/v1/metrics:batch"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Sentori-Sdk", "react-native/2.0.0")
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        202,
        "v2.0 SDK recordMetric batch must keep working on v2.1 server"
    );
}

/// v2.1's new endpoint accepts a valid auto-instrument batch. This
/// is the forward direction — not strictly a "compat" check, but
/// pinning that the endpoint is wired correctly without a DB.
#[tokio::test]
async fn v21_runtime_metrics_batch_accepted_without_db() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let payload = json!({
        "metrics": [
            { "name": "runtime.fps.p50", "value": 58.0,
              "tags": { "release": "myapp@2.0.0", "environment": "prod",
                        "device_class": "phone-mid" } },
            { "name": "runtime.heap.used_bytes", "value": 12345678.0,
              "tags": { "release": "myapp@2.0.0", "environment": "prod" } }
        ]
    });
    let resp = client
        .post(format!("http://{addr}/v1/runtime-metrics:batch"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .header("Sentori-Sdk", "react-native/2.1.0")
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        202,
        "v2.1 runtime-metrics batch must accept against a no-DB router"
    );
}

/// Reject path: oversize batch returns 400 (not 202). Pins the
/// MAX_BATCH guard.
#[tokio::test]
async fn v21_runtime_metrics_oversize_rejected() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let mut metrics: Vec<serde_json::Value> = Vec::with_capacity(600);
    for i in 0..600 {
        metrics.push(json!({
            "name": format!("runtime.fps.p{i}"),
            "value": 60.0
        }));
    }
    let payload = json!({ "metrics": metrics });
    let resp = client
        .post(format!("http://{addr}/v1/runtime-metrics:batch"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        400,
        "runtime-metrics batches > 500 points must be rejected"
    );
}
