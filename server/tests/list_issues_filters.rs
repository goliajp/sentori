// Phase 24 sub-A: server-side filter params for the issues list.
//
// Confirms `errorType` and `lastSeenAfter` URL params actually narrow
// the result set. The dashboard parses `errorType:Foo` / `last:24h`
// from the search box and forwards via these params.

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
        dev_token: "st_pk_listfilter000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "lf".to_string(),
        session_secret: "lf-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
    });
    Some((addr, pool))
}

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-listfilter-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-listfilter-1234" }))
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
    let email = format!("lf-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-lf-{}", &suffix[12..28]);
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

fn payload(error_type: &str, ts: &str) -> Value {
    json!({
        "id": Uuid::now_v7(),
        "timestamp": ts,
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

async fn ingest(addr: &SocketAddr, token: &str, error_type: &str, ts: &str) {
    let r = Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(token)
        .json(&payload(error_type, ts))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202);
}

#[tokio::test]
async fn list_issues_narrows_by_error_type_and_last_seen_after() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, cookie) = project_with_token(&addr, &pool).await;

    // Three distinct issues seeded with different timestamps. We use
    // wall-clock-anchored times so `last_seen_after` filtering is
    // deterministic relative to "now-ish".
    let now = time::OffsetDateTime::now_utc();
    let recent = now - time::Duration::minutes(30);
    let old = now - time::Duration::days(2);

    let recent_iso = recent
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let old_iso = old
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();

    ingest(&addr, &token, "Recent", &recent_iso).await;
    ingest(&addr, &token, "OldA", &old_iso).await;
    ingest(&addr, &token, "OldB", &old_iso).await;

    // Filter by errorType returns just that one row.
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues?status=active&errorType=OldA"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let rows: Vec<Value> = r.json().await.unwrap();
    let names: Vec<&str> = rows.iter().map(|r| r["errorType"].as_str().unwrap()).collect();
    assert_eq!(names, ["OldA"], "errorType filter");

    // lastSeenAfter cuts out the two old rows.
    let cutoff = (now - time::Duration::hours(1))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues"
        ))
        .query(&[("status", "active"), ("lastSeenAfter", cutoff.as_str())])
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let rows: Vec<Value> = r.json().await.unwrap();
    let names: Vec<&str> = rows.iter().map(|r| r["errorType"].as_str().unwrap()).collect();
    assert_eq!(names, ["Recent"], "lastSeenAfter narrows to within-window only");
}
