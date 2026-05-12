// Phase 23 sub-D: regression detection.
//
// Three behaviors:
//  1. Patching an issue to `resolved` stamps resolved_at +
//     resolved_in_release (taken from last_release at resolve time).
//  2. A fresh event matching a resolved issue's fingerprint flips it
//     atomically to `regressed`, stamping regressed_at + release on the
//     same row write.
//  3. The cron sweeper catches any row the ingest path missed.

use std::net::SocketAddr;

use reqwest::Client;
use sentori_server::{db, regression, router};
use serde_json::{Value, json};
use sqlx::{PgPool, types::Uuid};
use tokio::net::TcpListener;

async fn setup() -> Option<(SocketAddr, PgPool, String)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let dev_token = "st_pk_regression0000000000000000".to_string();
    let app = router::build(router::ServerConfig {
        dev_token: dev_token.clone(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "regr".to_string(),
        session_secret: "regr-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        metrics: None,
        self_trace: None,
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool, dev_token))
}

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> String {
    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-regression-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-regression-1234" }))
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

async fn create_project_and_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("regr-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-rg-{}", &suffix[12..28]);
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

fn event_payload(release: &str) -> Value {
    json!({
        "id": Uuid::now_v7(),
        "timestamp": "2026-05-10T12:00:00Z",
        "kind": "error",
        "platform": "javascript",
        "release": release,
        "environment": "prod",
        "device": { "os": "ios", "osVersion": "17", "model": "X", "locale": "en" },
        "app": { "version": "1.2.3", "build": "456" },
        "tags": {},
        "breadcrumbs": [],
        "error": {
            "type": "RegressionTestError",
            "message": "boom",
            "stack": [{
                "function": "f", "file": "a.ts", "line": 1,
                "inApp": true
            }]
        }
    })
}

async fn ingest(addr: &SocketAddr, token: &str, release: &str) {
    let r = Client::new()
        .post(format!("http://{addr}/v1/events"))
        .bearer_auth(token)
        .json(&event_payload(release))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202, "ingest failed: {}", r.text().await.unwrap());
}

#[tokio::test]
async fn ingest_flips_resolved_to_regressed_with_release() {
    let Some((addr, pool, _)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, cookie) = create_project_and_token(&addr, &pool).await;

    // 1. First event creates the issue.
    ingest(&addr, &token, "myapp@1.0.0").await;
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

    // 2. Resolve it.
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
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["status"].as_str().unwrap(), "resolved");
    assert!(body["resolvedAt"].is_string(), "resolvedAt stamped");
    assert_eq!(
        body["resolvedInRelease"].as_str().unwrap(),
        "myapp@1.0.0",
        "resolved_in_release captured from last_release",
    );

    // 3. Fresh event in a later release flips back to regressed.
    ingest(&addr, &token, "myapp@1.1.0").await;
    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/issues/{issue_id}"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["status"].as_str().unwrap(), "regressed");
    assert!(body["regressedAt"].is_string(), "regressedAt stamped");
    assert_eq!(
        body["regressedInRelease"].as_str().unwrap(),
        "myapp@1.1.0",
        "regressed_in_release captured from event payload",
    );
    // resolved_at is preserved on the row — useful for "last resolved
    // at X, regressed at Y" timeline rendering.
    assert!(body["resolvedAt"].is_string(), "resolvedAt preserved");
}

#[tokio::test]
async fn re_resolving_clears_regression_markers() {
    let Some((addr, pool, _)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token, cookie) = create_project_and_token(&addr, &pool).await;

    // Create → resolve → regress → re-resolve. The second resolve
    // should drop the regression markers so the next regression isn't
    // a no-op.
    ingest(&addr, &token, "myapp@2.0.0").await;
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

    let resolve = |body: Value| {
        let addr = addr;
        let issue_id = issue_id.clone();
        let cookie = cookie.clone();
        async move {
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
    };

    resolve(json!({ "status": "resolved" })).await;
    ingest(&addr, &token, "myapp@2.1.0").await; // → regressed
    let r = resolve(json!({ "status": "resolved" })).await;
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["status"].as_str().unwrap(), "resolved");
    assert!(
        body["regressedAt"].is_null(),
        "regressedAt cleared when re-resolving",
    );
    assert!(
        body["regressedInRelease"].is_null(),
        "regressedInRelease cleared when re-resolving",
    );
}

#[tokio::test]
async fn sweeper_catches_resolved_with_advanced_last_seen() {
    let Some((addr, pool, _)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // Need a real project so the FK on issues.project_id holds.
    let (project_id, _, _) = create_project_and_token(&addr, &pool).await;

    // Hand-roll a row that mimics the legacy bug: status=resolved but
    // last_seen advanced past resolved_at without the upsert path
    // having flipped it.
    let issue_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO issues
            (id, project_id, fingerprint, error_type, message_sample, status,
             first_seen, last_seen, event_count,
             last_environment, last_release,
             resolved_at, resolved_in_release)
        VALUES
            ($1, $2, $3, 'X', 'msg', 'resolved',
             '2026-05-10T11:00:00Z', '2026-05-10T13:00:00Z', 5,
             'prod', 'myapp@3.0.0',
             '2026-05-10T12:00:00Z', 'myapp@2.9.0')
        "#,
    )
    .bind(issue_id)
    .bind(project_id)
    .bind(format!("sweeper-{issue_id}"))
    .execute(&pool)
    .await
    .unwrap();

    let n = regression::sweep(&pool).await.unwrap();
    assert!(n >= 1, "sweeper picked up the planted row: {n}");

    let after: (String, Option<String>) = sqlx::query_as(
        "SELECT status, regressed_in_release FROM issues WHERE id = $1",
    )
    .bind(issue_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(after.0, "regressed");
    assert_eq!(after.1.as_deref(), Some("myapp@3.0.0"));

    sqlx::query("DELETE FROM issues WHERE id = $1")
        .bind(issue_id)
        .execute(&pool)
        .await
        .unwrap();
}
