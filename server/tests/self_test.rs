// F4 — /admin/api/self-test returns a JSON snapshot of platform
// health. The test runs against a Sentori with neither db nor
// valkey configured (so probes are skipped) and asserts the shape
// + correlation-id header per F1/F2.

use std::net::SocketAddr;

use sentori_server::router;
use serde_json::Value;
use tokio::net::TcpListener;

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

#[tokio::test]
async fn self_test_returns_health_snapshot() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://{addr}/admin/api/self-test"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(resp.headers().contains_key("x-sentori-correlation-id"));

    let body: Value = resp.json().await.unwrap();
    assert!(body.get("serverVersion").and_then(|v| v.as_str()).is_some());
    // db + valkey skipped (no config) → null fields, overall = green
    assert!(body.get("dbRtMs").is_some_and(|v| v.is_null()));
    assert!(body.get("valkeyRtMs").is_some_and(|v| v.is_null()));
    assert_eq!(body.get("overall").and_then(|v| v.as_str()), Some("green"));
}
