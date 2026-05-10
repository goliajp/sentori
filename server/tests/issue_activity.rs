// Phase 25 sub-E: per-issue activity stream + comments.
//
// Verifies the unified shape of `GET .../activity`:
//   - issue_comments rows render as `kind: "comment"` with author email
//   - resolved_at / regressed_at on the issue render as their own
//     entries (sub-D's regression detection drives those)
// The stream sorts by `at` ascending so the timeline reads top→bottom.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_activity00000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "act".to_string(),
        session_secret: "act-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        metrics: None,
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-activity-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-activity-1234" }))
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

async fn project_with_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("act-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-act-{}", &suffix[12..28]);
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
    (project_id, ingest, cookie, email)
}

fn payload(error_type: &str) -> Value {
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

#[tokio::test]
async fn activity_merges_comments_and_state_changes() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie, email) = project_with_token(&addr, &pool).await;

    // Seed an issue.
    let r = Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&payload("ActivityErr"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202);
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let issue_id = issues[0]["id"].as_str().unwrap().to_string();

    // Resolve, then drop another event to trigger regression.
    let r = Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "status": "resolved" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let r = Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&payload("ActivityErr"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202);

    // Post a comment.
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/comments"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "body": "looking into this" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "create: {}", r.text().await.unwrap());
    let comment_id = r.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Activity stream should have a comment + resolved + regressed.
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/activity"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let entries: Vec<Value> = r.json().await.unwrap();
    let kinds: Vec<&str> = entries.iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert!(kinds.contains(&"comment"), "kinds: {kinds:?}");
    assert!(kinds.contains(&"resolved"), "kinds: {kinds:?}");
    assert!(kinds.contains(&"regressed"), "kinds: {kinds:?}");

    let comment = entries.iter().find(|e| e["kind"] == "comment").unwrap();
    assert_eq!(comment["body"].as_str().unwrap(), "looking into this");
    assert_eq!(comment["authorEmail"].as_str().unwrap(), email);

    // Author can delete their own comment.
    let r = Client::new()
        .delete(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/comments/{comment_id}"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);
}

#[tokio::test]
async fn comment_body_validation() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie, _) = project_with_token(&addr, &pool).await;

    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(&ingest)
        .json(&payload("Vx"))
        .send()
        .await
        .unwrap();
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let issue_id = issues[0]["id"].as_str().unwrap().to_string();

    // Empty body → reject.
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/comments"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "body": "   " }))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_server_error() || r.status() == 400);

    // Over 2000 chars → reject.
    let huge = "x".repeat(2500);
    let r = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/comments"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "body": huge }))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_server_error() || r.status() == 400);
}
