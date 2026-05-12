// Phase 27 sub-D: webhook channel end-to-end.
//
// Spins up a tiny axum mock receiver in the same process, points a
// rule's webhook channel at it, fires the rule via the cron sweep,
// and verifies the receiver got a signed POST with the right shape.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    Router,
    extract::State,
    http::HeaderMap,
    response::IntoResponse,
    routing::post,
};
use reqwest::Client;
use sentori_server::{
    db,
    notifier::{NotifierConfig, NotifyEvent, SmtpTls},
    router, rule_eval, webhook, webhook_dispatch,
};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, mpsc};

#[derive(Clone, Default)]
struct Captured {
    inner: Arc<Mutex<Vec<CapturedDelivery>>>,
}

#[derive(Clone, Debug)]
struct CapturedDelivery {
    event: String,
    delivery_id: String,
    timestamp: String,
    signature: String,
    body: Vec<u8>,
}

async fn mock_handler(
    State(captured): State<Captured>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let h = |name: &str| -> String {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    captured.inner.lock().await.push(CapturedDelivery {
        body: body.to_vec(),
        delivery_id: h("sentori-delivery-id"),
        event: h("sentori-event"),
        signature: h("sentori-signature"),
        timestamp: h("sentori-timestamp"),
    });
    axum::http::StatusCode::OK
}

async fn spawn_mock_receiver() -> (SocketAddr, Captured) {
    let captured = Captured::default();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new().route("/hook", post(mock_handler)).with_state(captured.clone());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, captured)
}

async fn setup_server() -> Option<(SocketAddr, PgPool, mpsc::Sender<NotifyEvent>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    // Real notifier task: handles NotifyEvent::AlertFired, including
    // the webhook channel branch. The rule's channel array is
    // webhook-only here, so SMTP never actually sends — but
    // `notifier::handle` returns early when `cfg` is `None`, so we
    // pass a stub config (valid From address; SMTP host unreachable
    // but never dialed because no email channel fires).
    let cfg = NotifierConfig {
        smtp_host: "stub.invalid".to_string(),
        smtp_port: 0,
        smtp_user: None,
        smtp_pass: None,
        from: "test@test.invalid".to_string(),
        tls: SmtpTls::Plain,
    };
    let tx = sentori_server::notifier::start(Some(cfg), pool.clone());
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_webhook0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "wh".to_string(),
        session_secret: "wh-secret".to_string(),
        notifier_tx: Some(tx.clone()),
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool, tx))
}

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-webhook-1234" }))
        .send()
        .await
        .unwrap();
    let token: String = sqlx::query_scalar(
        "SELECT ev.token FROM email_verifications ev \
         JOIN users u ON u.id = ev.user_id WHERE u.email = $1",
    )
    .bind(email)
    .fetch_one(pool)
    .await
    .unwrap();
    Client::new()
        .get(format!("http://{addr}/api/auth/verify?token={token}"))
        .send()
        .await
        .unwrap();
    let login = Client::new()
        .post(format!("http://{addr}/api/auth/login"))
        .json(&json!({ "email": email, "password": "pw-webhook-1234" }))
        .send()
        .await
        .unwrap();
    login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .unwrap()
}

#[tokio::test]
async fn webhook_channel_signs_and_delivers() {
    let Some((addr, pool, tx)) = setup_server().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (mock_addr, captured) = spawn_mock_receiver().await;

    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("wh-{salt}@golia.test");
    let org_slug = format!("org-wh-{salt}");
    let cookie = register(&addr, &pool, &email).await;
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    let proj_resp = Client::new()
        .post(format!("http://{addr}/admin/api/orgs/{org_slug}/projects"))
        .header("cookie", &cookie)
        .json(&json!({ "name": "p1" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    let project_id = Uuid::parse_str(proj["id"].as_str().unwrap()).unwrap();

    let secret = "topsecret-shared";
    Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "Page hook",
            "triggerKind": "event_count",
            "triggerConfig": { "count": 1, "windowMinutes": 5 },
            "channels": [{
                "type": "webhook",
                "url": format!("http://{mock_addr}/hook"),
                "secret": secret,
            }],
            "throttleMinutes": 0,
        }))
        .send()
        .await
        .unwrap();

    // Seed an event so the cron sweep finds count >= 1.
    let now = time::OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO events (id, project_id, occurred_at, received_at, platform, release, \
         environment, error_type, error_message, payload) \
         VALUES ($1, $2, $3, $3, 'javascript', 'myapp@1.0.0', 'prod', 'X', 'msg', '{}'::JSONB)",
    )
    .bind(Uuid::now_v7())
    .bind(project_id)
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();

    // Phase 29 sub-B changed the notifier's webhook path from a direct
    // `webhook::send` to `webhook::enqueue` — the actual POST now ships
    // from `webhook_dispatch::sweep_once`. Wait for the notifier task to
    // run AlertFired (it's on a tokio::spawn loop reading the mpsc), then
    // drive the dispatcher once to flush the row.
    for _ in 0..50 {
        let pending: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM webhook_deliveries WHERE status = 'pending'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        if pending > 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    webhook_dispatch::sweep_once(&pool).await.unwrap();

    // Now the mock receiver should have the POST.
    for _ in 0..50 {
        if !captured.inner.lock().await.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let rows = captured.inner.lock().await.clone();
    assert_eq!(rows.len(), 1, "exactly one delivery: {rows:?}");
    let d = &rows[0];

    assert_eq!(d.event, "alert.fired");
    assert!(!d.delivery_id.is_empty());
    let ts: i64 = d.timestamp.parse().expect("timestamp parses");

    // sentori-signature is `t=<ts>,v1=<hex>` — extract hex tail.
    let mut t_part = "";
    let mut v1_part = "";
    for kv in d.signature.split(',') {
        if let Some(v) = kv.strip_prefix("t=") {
            t_part = v;
        } else if let Some(v) = kv.strip_prefix("v1=") {
            v1_part = v;
        }
    }
    assert_eq!(t_part, d.timestamp);
    assert_eq!(v1_part.len(), 64, "hex sha256 = 64 chars");

    // Verify HMAC over `<timestamp>.<raw-body>` matches the header.
    let expected = webhook::sign(secret, ts, &d.body);
    assert_eq!(v1_part, expected, "signature matches HMAC over `{{ts}}.{{body}}`");

    // Body shape sanity.
    let parsed: Value = serde_json::from_slice(&d.body).unwrap();
    assert_eq!(parsed["kind"].as_str().unwrap(), "alert.fired");
    assert_eq!(parsed["ruleName"].as_str().unwrap(), "Page hook");
    assert!(parsed["summary"].as_str().unwrap().contains("events"));
    assert!(parsed["firedAt"].is_string());
    assert!(parsed["id"].is_string());
}
