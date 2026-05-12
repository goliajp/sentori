// Phase 23 sub-E: release compare endpoint.
//
// Three buckets:
//   - `added`      → seen in target, not in base
//   - `fixed`      → seen in base, not in target
//   - `persisting` → seen in both
//
// We seed three distinct issues by varying error.type, ingest each
// against the relevant release(s), and assert the diff lands in the
// right bucket.

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
        dev_token: "st_pk_compare000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "compare".to_string(),
        session_secret: "compare-secret".to_string(),
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

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-compare-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-compare-1234" }))
        .send()
        .await
        .unwrap();
    login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .expect("session cookie")
}

async fn project_with_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("cmp-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-cm-{}", &suffix[12..28]);
    let cookie = register_user(addr, pool, &email).await;
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
            "stack": [{
                "function": format!("fn_{error_type}"),
                "file": "x.ts", "line": 1, "inApp": true
            }]
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
    assert_eq!(r.status(), 202, "ingest: {}", r.text().await.unwrap());
}

#[tokio::test]
async fn compare_buckets_three_distinct_issues() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, cookie) = project_with_token(&addr, &pool).await;

    // Three distinct error types (= 3 fingerprints = 3 issues).
    // Layout:
    //   IssueA appears only in 1.0.0   → fixed
    //   IssueB appears only in 1.1.0   → added
    //   IssueC appears in both         → persisting
    ingest(&addr, &token, "IssueA", "myapp@1.0.0").await;
    ingest(&addr, &token, "IssueB", "myapp@1.1.0").await;
    ingest(&addr, &token, "IssueC", "myapp@1.0.0").await;
    ingest(&addr, &token, "IssueC", "myapp@1.1.0").await;

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/releases/myapp%401.0.0/compare/myapp%401.1.0"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "compare 200: {}", r.text().await.unwrap());
    let body: Value = r.json().await.unwrap();

    assert_eq!(body["base"].as_str().unwrap(), "myapp@1.0.0");
    assert_eq!(body["target"].as_str().unwrap(), "myapp@1.1.0");

    let added = body["added"].as_array().unwrap();
    let fixed = body["fixed"].as_array().unwrap();
    let persisting = body["persisting"].as_array().unwrap();

    assert_eq!(added.len(), 1, "exactly IssueB in added: {added:?}");
    assert_eq!(added[0]["errorType"].as_str().unwrap(), "IssueB");
    assert_eq!(fixed.len(), 1, "exactly IssueA in fixed: {fixed:?}");
    assert_eq!(fixed[0]["errorType"].as_str().unwrap(), "IssueA");
    assert_eq!(persisting.len(), 1, "exactly IssueC in persisting: {persisting:?}");
    assert_eq!(persisting[0]["errorType"].as_str().unwrap(), "IssueC");

    // bucket label is on the row too — useful for future flat list views.
    assert_eq!(added[0]["bucket"].as_str().unwrap(), "added");
    assert_eq!(fixed[0]["bucket"].as_str().unwrap(), "fixed");
    assert_eq!(persisting[0]["bucket"].as_str().unwrap(), "persisting");
}

#[tokio::test]
async fn compare_rejects_same_release() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, _token, cookie) = project_with_token(&addr, &pool).await;
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/releases/v1/compare/v1"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert!(r.status().is_server_error() || r.status() == 400, "rejected: {}", r.status());
}
