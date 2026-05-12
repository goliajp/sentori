// Phase 23 sub-C: deploy webhook tests.
// Skips cleanly when DATABASE_URL isn't set.

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
        dev_token: "st_pk_deploys00000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "deploys".to_string(),
        session_secret: "deploys-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> (Uuid, String) {
    let _ = Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-deploys-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-deploys-1234" }))
        .send()
        .await
        .unwrap();
    let cookie = login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| {
            let s = v.to_str().ok()?;
            s.split(';').next().map(str::to_string)
        })
        .expect("session cookie");
    let user_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(email)
        .fetch_one(pool)
        .await
        .unwrap();
    (user_id, cookie)
}

async fn create_project_and_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("deploy-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-dp-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(addr, pool, &email).await;
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

    // Mint a public token via the admin API.
    let tok_resp = Client::new()
        .post(format!(
            "http://{addr}/admin/api/projects/{project_id}/tokens"
        ))
        .header("cookie", &cookie)
        .json(&json!({ "kind": "public", "label": "ci" }))
        .send()
        .await
        .unwrap();
    let tok: Value = tok_resp.json().await.unwrap();
    let token = tok["token"].as_str().unwrap().to_string();
    (project_id, token)
}

#[tokio::test]
async fn deploy_creates_release_with_now_default() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token) = create_project_and_token(&addr, &pool).await;

    let r = Client::new()
        .post(format!("http://{addr}/v1/deploys"))
        .bearer_auth(&token)
        .json(&json!({ "release": "myapp@1.2.3+456" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["release"].as_str().unwrap(), "myapp@1.2.3+456");
    assert!(body["deployAt"].is_string(), "deployAt is RFC 3339 string");

    // releases row landed.
    let stored: Option<(String,)> = sqlx::query_as(
        "SELECT name FROM releases WHERE project_id = $1 AND name = $2",
    )
    .bind(project_id)
    .bind("myapp@1.2.3+456")
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert!(stored.is_some(), "release row created");
}

#[tokio::test]
async fn deploy_is_idempotent_refreshes_deploy_at() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token) = create_project_and_token(&addr, &pool).await;

    let backdated = "2026-01-01T00:00:00Z";
    let r1 = Client::new()
        .post(format!("http://{addr}/v1/deploys"))
        .bearer_auth(&token)
        .json(&json!({ "release": "alpha@1.0.0", "deployedAt": backdated }))
        .send()
        .await
        .unwrap();
    assert_eq!(r1.status(), 201);
    let body: Value = r1.json().await.unwrap();
    assert!(body["deployAt"].as_str().unwrap().starts_with("2026-01-01"));

    // Second call without deployedAt → server's now() refreshes the column.
    let r2 = Client::new()
        .post(format!("http://{addr}/v1/deploys"))
        .bearer_auth(&token)
        .json(&json!({ "release": "alpha@1.0.0" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r2.status(), 201);
    let body2: Value = r2.json().await.unwrap();
    assert!(
        !body2["deployAt"].as_str().unwrap().starts_with("2026-01-01"),
        "deploy_at advanced",
    );

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM releases WHERE project_id = $1 AND name = $2")
            .bind(project_id)
            .bind("alpha@1.0.0")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1, "one row per (project, release)");
}

#[tokio::test]
async fn deploy_rejects_bad_input() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (_project_id, token) = create_project_and_token(&addr, &pool).await;

    // Missing token → 401 from require_token middleware.
    let r = Client::new()
        .post(format!("http://{addr}/v1/deploys"))
        .json(&json!({ "release": "x@1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);

    // Empty release name → 400.
    let r = Client::new()
        .post(format!("http://{addr}/v1/deploys"))
        .bearer_auth(&token)
        .json(&json!({ "release": "" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // 200+ char release → 400.
    let huge = "z".repeat(300);
    let r = Client::new()
        .post(format!("http://{addr}/v1/deploys"))
        .bearer_auth(&token)
        .json(&json!({ "release": huge }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
}
