// F1 — every response (success or error) carries a fresh
// `X-Sentori-Correlation-Id` header (uuid-v7 shape). This is the
// load-bearing contract behind structured errors + grep-able server
// logs; the test below asserts the header exists and parses as a
// uuid, on both a happy path and a failure path.

use std::net::SocketAddr;

use sentori_server::router;
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

#[tokio::test]
async fn correlation_id_header_present_on_2xx() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://{addr}/v1/events/_recent"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();

    let header = resp
        .headers()
        .get("x-sentori-correlation-id")
        .expect("X-Sentori-Correlation-Id missing on 2xx response");
    let value = header.to_str().expect("header value not ascii");
    Uuid::parse_str(value).expect("correlation id is not a parseable uuid");
}

#[tokio::test]
async fn correlation_id_header_present_on_4xx() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    // Missing Authorization → 401.
    let resp = client
        .get(format!("http://{addr}/v1/events/_recent"))
        .send()
        .await
        .unwrap();

    let header = resp
        .headers()
        .get("x-sentori-correlation-id")
        .expect("X-Sentori-Correlation-Id missing on 4xx response");
    let value = header.to_str().expect("header value not ascii");
    Uuid::parse_str(value).expect("correlation id on 4xx is not a parseable uuid");
}

#[tokio::test]
async fn correlation_id_is_fresh_per_request() {
    let addr = spawn().await;
    let client = reqwest::Client::new();
    let a = client
        .get(format!("http://{addr}/v1/events/_recent"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    let b = client
        .get(format!("http://{addr}/v1/events/_recent"))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    let id_a = a
        .headers()
        .get("x-sentori-correlation-id")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let id_b = b
        .headers()
        .get("x-sentori-correlation-id")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert_ne!(id_a, id_b, "correlation id must be unique per request");
}
