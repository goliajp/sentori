// Phase 27 sub-B: evaluator end-to-end tests.
//
// On-event triggers fire from the ingest path; cron triggers via the
// `sweep_once_for_tests` helper so we don't have to wait 60s. The
// notifier channel is not started — we wire a `mpsc::channel` directly
// and drain it to assert which alerts would have fired.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, notifier::NotifyEvent, router, rule_eval};
use serde_json::{Value, json};
use serial_test::serial;
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
        dev_token: "st_pk_aleval0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "ae".to_string(),
        session_secret: "ae-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-aleval-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-aleval-1234" }))
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

async fn project_with_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("ae-{salt}@golia.test");
    let org_slug = format!("org-ae-{salt}");
    let cookie = register(addr, pool, &email).await;
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
    let tok_resp = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/tokens"))
        .header("cookie", &cookie)
        .json(&json!({ "kind": "public", "label": "ingest" }))
        .send()
        .await
        .unwrap();
    let tok: Value = tok_resp.json().await.unwrap();
    let ingest = tok["token"].as_str().unwrap().to_string();
    (project_id, ingest, cookie, org_slug)
}

fn payload(error_type: &str, env: &str) -> Value {
    json!({
        "id": Uuid::now_v7(),
        "timestamp": "2026-05-10T12:00:00Z",
        "kind": "error",
        "platform": "javascript",
        "release": "myapp@1.0.0",
        "environment": env,
        "device": { "os": "ios", "osVersion": "17", "model": "X", "locale": "en" },
        "app": { "version": "1.0.0", "build": "1" },
        "tags": {},
        "breadcrumbs": [],
        "error": {
            "type": error_type,
            "message": format!("{error_type} happened"),
            "stack": [{ "function": "f", "file": "x.ts", "line": 1, "inApp": true }]
        }
    })
}

async fn drain(rx: &mut mpsc::Receiver<NotifyEvent>) -> Vec<NotifyEvent> {
    let mut out = Vec::new();
    while let Ok(ev) = rx.try_recv() {
        out.push(ev);
    }
    out
}

#[tokio::test]
#[serial]
async fn new_issue_rule_fires_on_first_event_with_filter_match() {
    let Some((addr, pool, _tx, mut rx)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie, org_slug) = project_with_token(&addr, &pool).await;

    // Arm a new_issue rule scoped to env=prod, errorTypeRegex matching `Type.*`.
    let resp = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "Page on TypeErrors",
            "triggerKind": "new_issue",
            "filterConfig": { "environment": "prod", "errorTypeRegex": "^Type" },
            "channels": [{ "type": "email", "to": ["x@example.com"] }],
            "throttleMinutes": 0
        }))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let rule_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    // Drain anything from setup.
    let _ = drain(&mut rx).await;

    // The new_issue trigger fires only when a fresh fingerprint shows
    // up (Phase 5: fingerprint = hash(error_type + frame.fn + frame.file),
    // env not included). So if event 1 and event 3 share error_type
    // they'll dedup and event 3 won't be a "new issue" — leaving the
    // filter assertion with nothing to match. Use distinct error_types
    // here so each event creates its own issue.
    //
    // event 1: staging "StagingErr" — new issue, but env filter rejects
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&payload("StagingErr", "staging"))
        .send()
        .await
        .unwrap();
    // event 2: prod "OtherError" — new issue, but regex ^Type rejects
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&payload("OtherError", "prod"))
        .send()
        .await
        .unwrap();
    // event 3: prod "TypeError" — new issue, filter matches → AlertFired
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&payload("TypeError", "prod"))
        .send()
        .await
        .unwrap();
    // give async paths a tick to land
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let events = drain(&mut rx).await;
    let alerts: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, NotifyEvent::AlertFired { rule_id: id, .. } if *id == rule_id))
        .collect();
    assert_eq!(alerts.len(), 1, "exactly one AlertFired for rule {rule_id}: {events:?}");
    if let NotifyEvent::AlertFired { rule_name, .. } = alerts[0] {
        assert_eq!(rule_name, "Page on TypeErrors");
    }
}

#[tokio::test]
#[serial]
async fn event_count_rule_fires_when_threshold_crossed() {
    let Some((_addr, pool, tx, mut rx)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, _ingest, cookie, org_slug) = project_with_token(&_addr, &pool).await;

    // Tests share the DB; other tests' stale Burst rules + events can
    // still trip a global sweep. Capture this rule's id so we filter
    // alerts down to the rule under test.
    let resp = Client::new()
        .post(format!("http://{_addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "Burst",
            "triggerKind": "event_count",
            "triggerConfig": { "count": 3, "windowMinutes": 5 },
            "channels": [{ "type": "email", "to": ["x@example.com"] }],
            "throttleMinutes": 0
        }))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let rule_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

    // Insert events directly with controlled timestamps so the count
    // is deterministic. Two inside the window, threshold not met.
    let now = time::OffsetDateTime::now_utc();
    for _ in 0..2 {
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
    }
    let _ = drain(&mut rx).await;
    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();
    let leaked: Vec<_> = drain(&mut rx).await.into_iter()
        .filter(|e| match e {
            NotifyEvent::AlertFired { rule_id: id, .. } => *id == rule_id,
            _ => false,
        })
        .collect();
    assert!(leaked.is_empty(), "below threshold: leaked={leaked:?}");

    // Third event tips us over. Sweep again.
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
    let alerts: Vec<_> = drain(&mut rx).await
        .into_iter()
        .filter(|e| match e {
            NotifyEvent::AlertFired { rule_id: id, .. } => *id == rule_id,
            _ => false,
        })
        .collect();
    assert_eq!(alerts.len(), 1, "fired exactly once");
}

#[tokio::test]
#[serial]
async fn throttle_blocks_repeat_fires() {
    let Some((addr, pool, tx, mut rx)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, _ingest, cookie, org_slug) = project_with_token(&addr, &pool).await;

    // Capture rule_id so the assertions are scoped to the rule under
    // test (the DB carries stale Throttled rules from prior runs).
    let resp = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "Throttled",
            "triggerKind": "event_count",
            "triggerConfig": { "count": 1, "windowMinutes": 5 },
            "channels": [{ "type": "email", "to": ["x@example.com"] }],
            "throttleMinutes": 60
        }))
        .send()
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    let rule_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();

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
    let _ = drain(&mut rx).await;

    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();
    let first = drain(&mut rx).await;
    assert!(first.iter().any(|e| matches!(e, NotifyEvent::AlertFired { rule_id: id, .. } if *id == rule_id)));

    // Second sweep within throttle window: nothing for THIS rule.
    rule_eval::sweep_once(&pool, Some(&tx)).await.unwrap();
    let second: Vec<_> = drain(&mut rx).await.into_iter()
        .filter(|e| matches!(e, NotifyEvent::AlertFired { rule_id: id, .. } if *id == rule_id))
        .collect();
    assert!(second.is_empty(), "throttle held: {second:?}");
}
