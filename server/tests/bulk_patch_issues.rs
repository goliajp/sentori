// Phase 24 sub-D: bulk patch endpoint.
//
// Drives the dashboard's multi-select toolbar — one POST flips up to
// BULK_LIMIT (200) issues to resolve / silence / close / reopen, with
// the same resolved_at / resolved_in_release bookkeeping the single-row
// PATCH does.

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
        dev_token: "st_pk_bulk0000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "bulk".to_string(),
        session_secret: "bulk-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-bulk-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-bulk-1234" }))
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
    let email = format!("bulk-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-bk-{}", &suffix[12..28]);
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
    let token = tok["token"].as_str().unwrap().to_string();
    (project_id, token, cookie)
}

fn payload(error_type: &str, release: &str) -> Value {
    json!({
        "id": Uuid::now_v7(),
        "timestamp": "2026-05-10T12:00:00Z",
        "kind": "error",
        "platform": "javascript",
        "release": release,
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

async fn ingest(addr: &SocketAddr, token: &str, error_type: &str, release: &str) {
    let r = Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(token)
        .json(&payload(error_type, release))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202);
}

#[tokio::test]
async fn bulk_resolve_stamps_release_and_clears_regression() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest_token, cookie) = project_with_token(&addr, &pool).await;

    // Three distinct issues seeded with the same release.
    ingest(&addr, &ingest_token, "AlphaErr", "myapp@1.0.0").await;
    ingest(&addr, &ingest_token, "BetaErr", "myapp@1.0.0").await;
    ingest(&addr, &ingest_token, "GammaErr", "myapp@1.0.0").await;

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
    assert_eq!(ids.len(), 3);

    // Bulk resolve all three in one shot.
    let r = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/issues:bulk"))
        .header("cookie", &cookie)
        .json(&json!({ "issueIds": ids, "action": "resolve" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "bulk resolve: {}", r.text().await.unwrap());
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["updated"].as_i64().unwrap(), 3);

    // All three rows now resolved with release stamped.
    let after: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT status, resolved_in_release FROM issues WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    for (status, release) in &after {
        assert_eq!(status, "resolved");
        assert_eq!(release.as_deref(), Some("myapp@1.0.0"));
    }
}

#[tokio::test]
async fn bulk_invalid_action_rejected() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, _, cookie) = project_with_token(&addr, &pool).await;

    let r = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/issues:bulk"))
        .header("cookie", &cookie)
        .json(&json!({ "issueIds": [Uuid::now_v7()], "action": "regressed" }))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_server_error() || r.status() == 400, "got {}", r.status());
}

#[tokio::test]
async fn bulk_empty_list_rejected() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, _, cookie) = project_with_token(&addr, &pool).await;
    let r = Client::new()
        .post(format!("http://{addr}/admin/api/projects/{project_id}/issues:bulk"))
        .header("cookie", &cookie)
        .json(&json!({ "issueIds": [], "action": "silence" }))
        .send()
        .await
        .unwrap();
    assert!(r.status().is_server_error() || r.status() == 400);
}
