// v1.2 W7.a — Linear inbound webhook refreshes external metadata.
//
// 1. Seed an issue + an issue_integration_links row pointing at a
//    Linear ticket id.
// 2. POST a synthetic Linear webhook payload with the correct
//    HMAC-SHA-256 signature (computed from the test's known
//    LINEAR_WEBHOOK_SECRET env value).
// 3. Read the integration-links list endpoint → expect
//    external_title + external_status + external_updated_at populated.

use std::net::SocketAddr;

use hmac::{Hmac, Mac};
use reqwest::Client;
use sentori_server::{db, router};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{types::Uuid, PgPool};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool)> {
    // The Linear webhook signature check expects the env var to be
    // set. Use a fixed value so the test signs with the same secret
    // the server verifies with. set_var is unsafe in 2024 edition;
    // tests don't multi-thread their own env so this is fine.
    unsafe {
        std::env::set_var("SENTORI_LINEAR_WEBHOOK_SECRET", "test-webhook-secret");
        std::env::set_var("SENTORI_LINEAR_CLIENT_ID", "noop-client-id");
        std::env::set_var("SENTORI_LINEAR_CLIENT_SECRET", "noop-client-secret");
    }
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: "st_pk_linwh00000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "linwh".to_string(),
        session_secret: "linwh-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-linwh-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-linwh-1234" }))
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
    let email = format!("linwh-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-lw-{}", &suffix[12..28]);
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
        .json(&event_payload("LinwhErr"))
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
    let sig = mac.finalize().into_bytes();
    sig.iter().map(|b| format!("{b:02x}")).collect()
}

#[tokio::test]
async fn linear_webhook_refreshes_external_metadata() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, ingest, cookie) = project_setup(&addr, &pool).await;
    let issue_id = seed_issue(&addr, &ingest, &cookie, project_id).await;

    // Seed the link row directly: outbound dispatch would normally
    // create this, but the test bypasses Linear's API.
    let linear_id = "linear-issue-uuid-xyz";
    sqlx::query(
        "INSERT INTO issue_integration_links \
            (issue_id, integration_kind, external_id, external_url) \
         VALUES ($1, 'linear', $2, $3)",
    )
    .bind(issue_id)
    .bind(linear_id)
    .bind("https://linear.app/test/issue/ENG-1")
    .execute(&pool)
    .await
    .unwrap();

    // POST a synthetic Linear webhook. Title and state.name are the
    // denormalised fields we expect to land on the link row.
    let body = json!({
        "type": "Issue",
        "action": "update",
        "data": {
            "id": linear_id,
            "title": "Fix login regression",
            "state": { "type": "started", "name": "In Progress" }
        }
    });
    let body_bytes = serde_json::to_vec(&body).unwrap();
    let signature = sign("test-webhook-secret", &body_bytes);

    let r = Client::new()
        .post(format!("http://{addr}/v1/integrations/linear/webhook"))
        .header("linear-signature", signature)
        .header("content-type", "application/json")
        .body(body_bytes)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "webhook: {}", r.text().await.unwrap());

    // Read back the link row via the new admin endpoint.
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
    assert_eq!(links.len(), 1);
    let link = &links[0];
    assert_eq!(link["integrationKind"].as_str().unwrap(), "linear");
    assert_eq!(link["externalId"].as_str().unwrap(), linear_id);
    assert_eq!(link["externalTitle"].as_str().unwrap(), "Fix login regression");
    assert_eq!(link["externalStatus"].as_str().unwrap(), "In Progress");
    assert!(!link["externalUpdatedAt"].is_null());
}

#[tokio::test]
async fn linear_webhook_with_bad_signature_returns_401() {
    let Some((addr, _pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let body = json!({ "type": "Issue", "action": "update", "data": { "id": "x" } });
    let r = Client::new()
        .post(format!("http://{addr}/v1/integrations/linear/webhook"))
        .header("linear-signature", "deadbeef")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
}
