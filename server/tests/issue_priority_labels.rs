// v1.2 W4 — priority + labels schema, PATCH wire-up, and filter UX.
//
// Verifies:
//   - default priority is p3, default labels = []
//   - PATCH accepts priority + labels and the response reflects them
//   - PATCH activity_log entries: priorityChanged, labelsChanged
//     (with diff) — built on top of W5's feed
//   - LIST filters: ?priority=p0,p1 selects only those; ?labels=frontend
//     selects only issues whose labels array contains it
//   - Invalid priority returns 4xx/5xx (current style)

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
        dev_token: "st_pk_priolb000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "prio".to_string(),
        session_secret: "prio-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-prio-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-prio-1234" }))
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
    let email = format!("prio-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-pr-{}", &suffix[12..28]);
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

async fn seed_issue(
    addr: &SocketAddr,
    ingest: &str,
    cookie: &str,
    project_id: Uuid,
    kind: &str,
) -> Uuid {
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

async fn patch(addr: &SocketAddr, cookie: &str, project_id: Uuid, issue_id: Uuid, body: Value) -> reqwest::Response {
    Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", cookie)
        .json(&body)
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn new_issue_defaults_to_p3_and_empty_labels() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "PrioDefA").await;

    let issue: Value = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(issue["priority"].as_str().unwrap(), "p3");
    assert_eq!(
        issue["labels"].as_array().unwrap().len(),
        0,
        "labels default empty: {issue}"
    );
}

#[tokio::test]
async fn patch_priority_writes_activity_log() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "PrioSetA").await;

    let r = patch(&addr, &cookie, project_id, issue_id, json!({ "priority": "p0" })).await;
    assert_eq!(r.status(), 200);
    let updated: Value = r.json().await.unwrap();
    assert_eq!(updated["priority"].as_str().unwrap(), "p0");

    let entries: Vec<Value> = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/activity"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let pc = entries
        .iter()
        .find(|e| e["kind"] == "priorityChanged")
        .expect("priorityChanged present");
    assert_eq!(pc["from"].as_str().unwrap(), "p3");
    assert_eq!(pc["to"].as_str().unwrap(), "p0");
}

#[tokio::test]
async fn patch_labels_diff_in_activity_log() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "PrioLblA").await;

    // First set: add two labels
    patch(&addr, &cookie, project_id, issue_id, json!({ "labels": ["frontend", "login"] }))
        .await;
    // Second set: drop "login", add "auth"
    patch(&addr, &cookie, project_id, issue_id, json!({ "labels": ["frontend", "auth"] }))
        .await;

    let issue: Value = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let labels: Vec<&str> = issue["labels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    // sorted in DB; assert both present.
    assert!(labels.contains(&"frontend"));
    assert!(labels.contains(&"auth"));
    assert!(!labels.contains(&"login"));

    let entries: Vec<Value> = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/activity"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let label_entries: Vec<&Value> = entries
        .iter()
        .filter(|e| e["kind"] == "labelsChanged")
        .collect();
    assert_eq!(label_entries.len(), 2, "two labels changes: {entries:?}");
    // Second (latest) entry's diff:
    let last = label_entries[1];
    let added: Vec<&str> = last["added"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    let removed: Vec<&str> = last["removed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(added.contains(&"auth"), "added: {added:?}");
    assert!(removed.contains(&"login"), "removed: {removed:?}");
}

#[tokio::test]
async fn invalid_priority_rejected() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id, "PrioBadA").await;

    let r = patch(&addr, &cookie, project_id, issue_id, json!({ "priority": "p5" })).await;
    assert!(r.status().is_server_error() || r.status() == 400, "{r:?}");
}

#[tokio::test]
async fn list_filter_priority_and_labels() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_with_token(&addr, &pool).await;
    let a = seed_issue(&addr, &ingest, &cookie, project_id, "FiltP0A").await;
    let b = seed_issue(&addr, &ingest, &cookie, project_id, "FiltP1B").await;
    let c = seed_issue(&addr, &ingest, &cookie, project_id, "FiltP3C").await;

    patch(&addr, &cookie, project_id, a, json!({ "priority": "p0", "labels": ["frontend"] })).await;
    patch(&addr, &cookie, project_id, b, json!({ "priority": "p1", "labels": ["backend"] })).await;
    // c left at default p3 + empty labels.

    // priority=p0,p1 → returns a and b but not c.
    let rows: Vec<Value> = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues?status=any&priority=p0,p1"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ids: Vec<&str> = rows.iter().map(|r| r["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&a.to_string().as_str()), "a present: {ids:?}");
    assert!(ids.contains(&b.to_string().as_str()), "b present: {ids:?}");
    assert!(!ids.contains(&c.to_string().as_str()), "c absent: {ids:?}");

    // labels=frontend → only a.
    let rows: Vec<Value> = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues?status=any&labels=frontend"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ids: Vec<&str> = rows.iter().map(|r| r["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec![a.to_string().as_str()]);
}
