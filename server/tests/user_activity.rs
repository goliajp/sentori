// Phase 20 sub-A + sub-C:
//
//  - audit_logs survives org delete (FK ON DELETE SET NULL); the
//    activity feed for the actor still surfaces the row, with org
//    fields nulled.
//  - /api/users/me/activity returns rows scoped to the caller across
//    every org they were involved in.

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
        dev_token: "st_pk_useract000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "useract".to_string(),
        session_secret: "useract-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await.unwrap();
    });
    Some((addr, pool))
}

async fn register_user(addr: &SocketAddr, pool: &PgPool, email: &str) -> (Uuid, String) {
    let _ = Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-useract-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-useract-1234" }))
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

#[tokio::test]
async fn audit_actions_endpoint_returns_catalog() {
    let Some((addr, _pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    // Need a session — endpoint is under /api which requires require_user.
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("ua-cat-{}@golia.test", &suffix[12..28]);
    let pool_url = std::env::var("DATABASE_URL").unwrap();
    let pool = db::connect(&pool_url).await.unwrap();
    let (_, cookie) = register_user(&addr, &pool, &email).await;

    let r = Client::new()
        .get(format!("http://{addr}/api/audit/actions"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let body: Vec<Value> = r.json().await.unwrap();
    assert!(
        body.iter().any(|e| e["code"] == "team.created"),
        "team.created in catalog",
    );
    assert!(
        body.iter().any(|e| e["code"] == "org.deleted"),
        "org.deleted in catalog",
    );
}

#[tokio::test]
async fn activity_returns_caller_rows() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("ua-feed-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-ua-{}", &suffix[12..28]);
    let (_uid, cookie) = register_user(&addr, &pool, &email).await;

    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();
    Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/teams"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": "alpha", "name": "Alpha" }))
        .send()
        .await
        .unwrap();

    let r = Client::new()
        .get(format!("http://{addr}/api/users/me/activity"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = r.json().await.unwrap();
    let actions: Vec<&str> = rows
        .iter()
        .map(|r| r["action"].as_str().unwrap())
        .collect();
    assert!(actions.contains(&"org.created"), "org.created: {actions:?}");
    assert!(actions.contains(&"team.created"), "team.created: {actions:?}");

    // org slug is included on every entry while the org is alive.
    for r in &rows {
        assert_eq!(r["orgSlug"].as_str().unwrap(), org_slug);
    }
}

#[tokio::test]
async fn audit_log_survives_org_delete_with_null_org_id() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let suffix = Uuid::now_v7().simple().to_string();
    let email = format!("ua-tomb-{}@golia.test", &suffix[12..28]);
    let org_slug = format!("org-ut-{}", &suffix[12..28]);
    let (uid, cookie) = register_user(&addr, &pool, &email).await;

    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();

    let org_id: Uuid =
        sqlx::query_scalar("SELECT id FROM orgs WHERE slug = $1")
            .bind(&org_slug)
            .fetch_one(&pool)
            .await
            .unwrap();

    // Trigger org delete.
    let del = Client::new()
        .delete(format!("http://{addr}/api/orgs/{org_slug}"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), 200);

    // The org row is gone …
    let still: Option<Uuid> = sqlx::query_scalar("SELECT id FROM orgs WHERE id = $1")
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(still.is_none(), "org row deleted");

    // … but the audit_logs entries the caller authored still exist
    // with org_id = NULL (FK ON DELETE SET NULL).
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_logs WHERE actor_user_id = $1 AND org_id IS NULL",
    )
    .bind(uid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(count >= 2, "expect tombstoned org.created + org.deleted (got {count})");

    // And /me/activity surfaces them with orgSlug == null + the
    // "deleted org" UI path is what the dashboard renders.
    let r = Client::new()
        .get(format!("http://{addr}/api/users/me/activity"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let rows: Vec<Value> = r.json().await.unwrap();
    let null_orgs = rows.iter().filter(|r| r["orgSlug"].is_null()).count();
    assert!(null_orgs >= 2, "expect tombstoned rows in feed");
}
