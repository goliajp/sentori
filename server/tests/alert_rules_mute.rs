// Phase 27 sub-F: mute / snooze.
//
// Verifies the evaluator skips rules whose mute or snooze flag is set,
// and that PATCHing snoozed_until: null clears the snooze early.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, notifier::NotifyEvent, router, rule_eval};
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
        dev_token: "st_pk_mute0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "mu".to_string(),
        session_secret: "mu-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-mute-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-mute-1234" }))
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

async fn drain_alerts(rx: &mut mpsc::Receiver<NotifyEvent>) -> Vec<NotifyEvent> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        if matches!(ev, NotifyEvent::AlertFired { .. }) {
            out.push(ev);
        }
    }
    out
}

#[tokio::test]
async fn mute_blocks_fire_until_unmuted() {
    let Some((addr, pool, tx, mut rx)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("mu-{salt}@golia.test");
    let org_slug = format!("org-mu-{salt}");
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

    // Easy event_count rule: 1 event in 5m fires.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "Burst",
            "triggerKind": "event_count",
            "triggerConfig": { "count": 1, "windowMinutes": 5 },
            "channels": [{ "type": "email", "to": ["x@example.com"] }],
            "throttleMinutes": 0,
            "muted": true,
        }))
        .send()
        .await
        .unwrap();
    let rule_id = r.json::<Value>().await.unwrap()["id"].as_str().unwrap().to_string();

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
    let _ = drain_alerts(&mut rx).await;

    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();
    assert!(drain_alerts(&mut rx).await.is_empty(), "muted rule does not fire");

    // Unmute and re-sweep — fires.
    let r = Client::new()
        .patch(format!("http://{addr}/api/orgs/{org_slug}/alert-rules/{rule_id}"))
        .header("cookie", &cookie)
        .json(&json!({ "muted": false }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();
    assert_eq!(drain_alerts(&mut rx).await.len(), 1, "unmuted fires");
}

#[tokio::test]
async fn snooze_until_blocks_then_clears_when_passed() {
    let Some((addr, pool, tx, mut rx)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("sn-{salt}@golia.test");
    let org_slug = format!("org-sn-{salt}");
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

    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "Snoozed",
            "triggerKind": "event_count",
            "triggerConfig": { "count": 1, "windowMinutes": 5 },
            "channels": [{ "type": "email", "to": ["x@example.com"] }],
            "throttleMinutes": 0,
        }))
        .send()
        .await
        .unwrap();
    let rule_id = r.json::<Value>().await.unwrap()["id"].as_str().unwrap().to_string();

    // Snooze until 1h from now (active).
    let until = time::OffsetDateTime::now_utc() + time::Duration::hours(1);
    let until_iso = until.format(&time::format_description::well_known::Rfc3339).unwrap();
    Client::new()
        .patch(format!("http://{addr}/api/orgs/{org_slug}/alert-rules/{rule_id}"))
        .header("cookie", &cookie)
        .json(&json!({ "snoozedUntil": until_iso }))
        .send()
        .await
        .unwrap();

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
    let _ = drain_alerts(&mut rx).await;

    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();
    assert!(drain_alerts(&mut rx).await.is_empty(), "snooze active");

    // Clear snooze with explicit null → fires.
    Client::new()
        .patch(format!("http://{addr}/api/orgs/{org_slug}/alert-rules/{rule_id}"))
        .header("cookie", &cookie)
        .json(&json!({ "snoozedUntil": null }))
        .send()
        .await
        .unwrap();
    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();
    assert_eq!(drain_alerts(&mut rx).await.len(), 1, "cleared snooze fires");
}
