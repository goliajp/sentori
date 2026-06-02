// v1.2 W5 — activity_log writes on every issue mutation, and
// list_issue_activity returns the unified feed:
//   - comments (full body, from issue_comments)
//   - resolved (from activity_log status_changed with to=resolved)
//   - regressed (from activity_log REGRESSED — ingest-driven)
//   - statusChanged (silenced / closed / reopened / muted)
//   - assigneeChanged
//   - merged
//
// Also: legacy issues whose resolve/regress predate the W5 migration
// still surface via the synthesised fallback. Tested by writing
// directly to `issues.resolved_at` without touching activity_log.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{json, Value};
use sqlx::{types::Uuid, PgPool};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_actlog000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "actlog".to_string(),
        session_secret: "actlog-secret".to_string(),
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
    Some((addr, pool))
}

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-actlog-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-actlog-1234" }))
        .send()
        .await
        .unwrap();
    login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .expect("cookie")
}

async fn project_with_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("alog-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-al-{}", &suffix[12..28]);
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
    (project_id, ingest, cookie)
}

fn event_payload(error_type: &str) -> Value {
    json!({
        "id": Uuid::now_v7(),
        "timestamp": "2026-05-10T12:00:00Z",
        "kind": "error",
        "platform": "javascript",
        "release": "myapp@1.0.0",
        "environment": "prod",
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

async fn seed_issue(addr: &SocketAddr, ingest: &str, cookie: &str, project_id: Uuid, kind: &str) -> Uuid {
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(ingest)
        .json(&event_payload(kind))
        .send()
        .await
        .unwrap();
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues"))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id_str = issues
        .iter()
        .find(|i| i["errorType"] == kind)
        .unwrap()["id"]
        .as_str()
        .unwrap();
    Uuid::parse_str(id_str).unwrap()
}

async fn list_activity(addr: &SocketAddr, cookie: &str, project_id: Uuid, issue_id: Uuid) -> Vec<Value> {
    Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/activity"
        ))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap()
}

#[tokio::test]
async fn status_silence_emits_status_changed_entry() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "ALogSilA").await;

    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "status": "silenced" }))
        .send()
        .await
        .unwrap();

    let entries = list_activity(&addr, &cookie, project_id, issue_id).await;
    let sc = entries
        .iter()
        .find(|e| e["kind"] == "statusChanged")
        .expect("statusChanged present");
    assert_eq!(sc["to"].as_str().unwrap(), "silenced");
    assert_eq!(sc["from"].as_str().unwrap(), "active");
    assert_eq!(sc["bulk"].as_bool().unwrap(), false);
    assert!(!sc["actorId"].is_null());
}

#[tokio::test]
async fn status_resolved_emits_legacy_kind() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "ALogResA").await;

    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "status": "resolved" }))
        .send()
        .await
        .unwrap();

    let entries = list_activity(&addr, &cookie, project_id, issue_id).await;
    // Resolved status_changed renders as the legacy kind="resolved"
    // so the dashboard's existing icon path keeps working.
    let resolved_count = entries.iter().filter(|e| e["kind"] == "resolved").count();
    assert_eq!(resolved_count, 1, "exactly one resolved entry: {entries:?}");
    let resolved = entries.iter().find(|e| e["kind"] == "resolved").unwrap();
    assert!(!resolved["actorId"].is_null());
}

#[tokio::test]
async fn ingest_regression_emits_regressed_entry() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "ALogRegA").await;

    // Resolve, then drop another event → regression.
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "status": "resolved" }))
        .send()
        .await
        .unwrap();
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&event_payload("ALogRegA"))
        .send()
        .await
        .unwrap();

    // Give the spawned activity_log write a tick to land.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let entries = list_activity(&addr, &cookie, project_id, issue_id).await;
    let regressed = entries
        .iter()
        .filter(|e| e["kind"] == "regressed")
        .collect::<Vec<_>>();
    assert_eq!(regressed.len(), 1, "exactly one regressed entry: {entries:?}");
}

#[tokio::test]
async fn assignee_change_emits_assignee_changed_entry() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "ALogAsgA").await;

    // Assign to self — caller is the project owner.
    let me: Uuid = sqlx::query_scalar("SELECT user_id FROM memberships LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "assigneeUserId": me }))
        .send()
        .await
        .unwrap();

    let entries = list_activity(&addr, &cookie, project_id, issue_id).await;
    let ac = entries
        .iter()
        .find(|e| e["kind"] == "assigneeChanged")
        .expect("assigneeChanged present");
    assert_eq!(ac["to"].as_str().unwrap(), me.to_string());
    assert!(ac["from"].is_null(), "from should be null on first assign");
    assert_eq!(ac["bulk"].as_bool().unwrap(), false);
}

#[tokio::test]
async fn comment_emits_kind_comment_not_status_changed() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "ALogCmtA").await;

    Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/comments"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "body": "tracing this" }))
        .send()
        .await
        .unwrap();

    let entries = list_activity(&addr, &cookie, project_id, issue_id).await;
    // Exactly one comment entry; no duplicate from the activity_log
    // commented row (list_issue_activity filters those out).
    let comments: Vec<_> = entries.iter().filter(|e| e["kind"] == "comment").collect();
    assert_eq!(comments.len(), 1, "one comment row, no duplicate: {entries:?}");
    assert_eq!(comments[0]["body"].as_str().unwrap(), "tracing this");
}

#[tokio::test]
async fn legacy_resolve_without_log_falls_through_to_synthesis() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "ALogLegA").await;

    // Stamp resolved_at directly on the issue row, bypassing the
    // patch_issue path. This simulates a row whose resolve predates
    // the W5 migration — no activity_log row exists.
    sqlx::query(
        "UPDATE issues SET status = 'resolved', resolved_at = now(), \
         resolved_in_release = 'pre-w5-release' WHERE id = $1",
    )
    .bind(issue_id)
    .execute(&pool)
    .await
    .unwrap();

    let entries = list_activity(&addr, &cookie, project_id, issue_id).await;
    let resolved = entries
        .iter()
        .find(|e| e["kind"] == "resolved")
        .expect("synthesised resolved entry");
    assert_eq!(resolved["release"].as_str().unwrap(), "pre-w5-release");
    // Synthesised entries have actor_id=null (we don't know who did it).
    assert!(resolved["actorId"].is_null());
}
