// Phase 27 sub-E: digest subscribe / sweep / unsubscribe.
//
// Drives the cron via `digest::sweep_once` so we don't wait an hour;
// captures DigestEmail events from a notifier-tx stub.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, digest, notifier::NotifyEvent, router};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

async fn setup() -> Option<(SocketAddr, PgPool, mpsc::Sender<NotifyEvent>, mpsc::Receiver<NotifyEvent>)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let (tx, rx) = mpsc::channel::<NotifyEvent>(64);
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_digests000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "dg".to_string(),
        session_secret: "dg-secret".to_string(),
        notifier_tx: Some(tx.clone()),
        base_url: "http://localhost:8080".to_string(),
        metrics: None,
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool, tx, rx))
}

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-digest-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-digest-1234" }))
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
async fn subscribe_then_sweep_then_unsubscribe() {
    let Some((addr, pool, tx, mut rx)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("dg-{salt}@golia.test");
    let org_slug = format!("org-dg-{salt}");
    let cookie = register(&addr, &pool, &email).await;
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();

    // Subscribe daily.
    let r = Client::new()
        .post(format!("http://{addr}/api/users/me/digests"))
        .header("cookie", &cookie)
        .json(&json!({ "orgSlug": org_slug, "frequency": "daily" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "subscribe: {}", r.text().await.unwrap());

    // List.
    let r = Client::new()
        .get(format!("http://{addr}/api/users/me/digests"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["frequency"].as_str().unwrap(), "daily");
    assert!(rows[0]["lastSentAt"].is_null());

    // First sweep should fire — last_sent_at is NULL → due.
    let sent = digest::sweep_once(&pool, Some(&tx)).await.unwrap();
    assert_eq!(sent, 1, "one digest fired");
    let mut digests: Vec<NotifyEvent> = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        if matches!(ev, NotifyEvent::DigestEmail { .. }) {
            digests.push(ev);
        }
    }
    assert_eq!(digests.len(), 1);
    if let NotifyEvent::DigestEmail { to, frequency, summary_lines, window_hours, .. } =
        &digests[0]
    {
        assert_eq!(to, &email);
        assert_eq!(frequency, "daily");
        assert_eq!(*window_hours, 24);
        assert!(summary_lines.iter().any(|l| l.contains("Crash-free")));
    }

    // Second sweep within 24h: nothing (last_sent_at advanced).
    let sent = digest::sweep_once(&pool, Some(&tx)).await.unwrap();
    assert_eq!(sent, 0, "throttled by 24h window");

    // Unsubscribe + verify gone.
    let r = Client::new()
        .delete(format!(
            "http://{addr}/api/users/me/digests/{org_slug}/daily"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);
    let rows: Vec<Value> = Client::new()
        .get(format!("http://{addr}/api/users/me/digests"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rows.len(), 0);
}

#[tokio::test]
async fn subscribe_rejects_unknown_org_or_frequency() {
    let Some((addr, pool, _tx, _rx)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("dgv-{salt}@golia.test");
    let cookie = register(&addr, &pool, &email).await;

    let r = Client::new()
        .post(format!("http://{addr}/api/users/me/digests"))
        .header("cookie", &cookie)
        .json(&json!({ "orgSlug": "ghost-org", "frequency": "daily" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 404);

    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": format!("org-rev-{salt}"), "name": "x" }))
        .send()
        .await
        .unwrap();
    let r = Client::new()
        .post(format!("http://{addr}/api/users/me/digests"))
        .header("cookie", &cookie)
        .json(&json!({ "orgSlug": format!("org-rev-{salt}"), "frequency": "monthly" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
}
