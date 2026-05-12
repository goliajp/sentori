// Phase 25 sub-F: assignee + resolved-in-release override + bulk assign.
//
// Three scenarios:
//   1. Single PATCH `assigneeUserId` sets, then `null` clears.
//   2. Single PATCH `status: "resolved"` with `resolvedInRelease`
//      uses that release instead of last_release.
//   3. Bulk `action: "assign"` flips multiple rows in one shot.

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
        dev_token: "st_pk_assignee0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "asn".to_string(),
        session_secret: "asn-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        metrics: None,
        self_trace: None,
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn register(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-assignee-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-assignee-1234" }))
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
    let email = format!("asn-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-asn-{}", &suffix[12..28]);
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
    (project_id, tok["token"].as_str().unwrap().to_string(), cookie, email)
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

async fn ingest(addr: &SocketAddr, token: &str, error_type: &str) {
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(token)
        .json(&payload(error_type))
        .send()
        .await
        .unwrap();
}

#[tokio::test]
async fn patch_assignee_set_and_clear() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest_token, cookie, email) = project_with_token(&addr, &pool).await;

    ingest(&addr, &ingest_token, "AsnErr").await;
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
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&pool)
        .await
        .unwrap();

    // Assign self.
    let r = Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "assigneeUserId": user_id.to_string() }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["assigneeUserId"].as_str().unwrap(), user_id.to_string());
    assert_eq!(body["assigneeEmail"].as_str().unwrap(), email);

    // Clear with explicit null.
    let r = Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "assigneeUserId": null }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    assert!(body["assigneeUserId"].is_null());
    assert!(body["assigneeEmail"].is_null());
}

#[tokio::test]
async fn patch_resolve_with_release_override() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest_token, cookie, _) = project_with_token(&addr, &pool).await;

    ingest(&addr, &ingest_token, "RelOverride").await;
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

    // last_release is myapp@1.0.0; pin resolve to a different name.
    let r = Client::new()
        .patch(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "status": "resolved", "resolvedInRelease": "myapp@1.2.0" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["status"].as_str().unwrap(), "resolved");
    assert_eq!(
        body["resolvedInRelease"].as_str().unwrap(),
        "myapp@1.2.0",
        "override wins over last_release",
    );
}

#[tokio::test]
async fn bulk_assign_flips_multiple_rows() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest_token, cookie, email) = project_with_token(&addr, &pool).await;

    ingest(&addr, &ingest_token, "BAsnA").await;
    ingest(&addr, &ingest_token, "BAsnB").await;
    ingest(&addr, &ingest_token, "BAsnC").await;
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let ids: Vec<String> = issues.iter().map(|i| i["id"].as_str().unwrap().to_string()).collect();
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_one(&pool)
        .await
        .unwrap();

    let r = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/issues:bulk"))
        .header("cookie", &cookie)
        .json(&json!({
            "issueIds": ids,
            "action": "assign",
            "assigneeUserId": user_id.to_string()
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "bulk assign: {}", r.text().await.unwrap());
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["updated"].as_i64().unwrap(), 3);

    let assigned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1 AND assignee_user_id = $2",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(assigned, 3);
}
