// v1.2 W7.b — GitHub Issues inbound webhook.

use std::net::SocketAddr;

use hmac::{Hmac, Mac};
use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{types::Uuid, PgPool};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool)> {
    unsafe {
        std::env::set_var("SENTORI_GITHUB_WEBHOOK_SECRET", "gh-test-secret");
    }
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_ghwh0000000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "ghwh".to_string(),
        session_secret: "ghwh-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-ghwh-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-ghwh-1234" }))
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

async fn project_setup(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("ghwh-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-gh-{}", &suffix[12..28]);
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

async fn seed_issue(addr: &SocketAddr, ingest: &str, cookie: &str, project_id: Uuid) -> Uuid {
    Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(ingest)
        .json(&event_payload("GhwhErr"))
        .send()
        .await
        .unwrap();
    let issues: Vec<Value> = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues?status=any"))
        .header("cookie", cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    Uuid::parse_str(issues[0]["id"].as_str().unwrap()).unwrap()
}

fn sign(secret: &str, body: &[u8]) -> String {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(body);
    let bytes = mac.finalize().into_bytes();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("sha256={hex}")
}

#[tokio::test]
async fn github_webhook_refreshes_metadata_and_syncs_status() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id).await;

    let external_id = "acme/app#42";
    sqlx::query(
        "INSERT INTO issue_integration_links \
            (issue_id, integration_kind, external_id, external_url) \
         VALUES ($1, 'github', $2, $3)",
    )
    .bind(issue_id)
    .bind(external_id)
    .bind("https://github.com/acme/app/issues/42")
    .execute(&pool)
    .await
    .unwrap();

    let body = json!({
        "action": "closed",
        "issue": {
            "number": 42,
            "title": "Fix login regression",
            "state": "closed",
            "html_url": "https://github.com/acme/app/issues/42",
        },
        "repository": { "full_name": "acme/app" }
    });
    let body_bytes = serde_json::to_vec(&body).unwrap();
    let signature = sign("gh-test-secret", &body_bytes);

    let r = Client::new()
        .post(format!("http://{addr}/v1/integrations/github/webhook"))
        .header("x-hub-signature-256", signature)
        .header("x-github-event", "issues")
        .header("content-type", "application/json")
        .body(body_bytes)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "webhook: {}", r.text().await.unwrap());

    let links: Vec<Value> = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}/integration-links"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let link = &links[0];
    assert_eq!(link["externalTitle"].as_str().unwrap(), "Fix login regression");
    assert_eq!(link["externalStatus"].as_str().unwrap(), "closed");

    // Sentori-side issue should now be resolved.
    let issue: Value = Client::new()
        .get(format!("http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(issue["status"].as_str().unwrap(), "resolved");
}

#[tokio::test]
async fn github_webhook_bad_signature_returns_401() {
    let Some((addr, _pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let r = Client::new()
        .post(format!("http://{addr}/v1/integrations/github/webhook"))
        .header("x-hub-signature-256", "sha256=deadbeef")
        .header("x-github-event", "issues")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
}
