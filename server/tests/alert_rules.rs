// Phase 27 sub-A: alert rules CRUD + authz.
//
// Verifies create/list/patch/delete and the admin-only gate. Two
// callers: an org owner (allowed) and a plain member (read-only).

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
        dev_token: "st_pk_alerts0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "ar".to_string(),
        session_secret: "ar-secret".to_string(),
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
        .json(&json!({ "email": email, "password": "pw-alerts-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-alerts-1234" }))
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

#[tokio::test]
async fn rule_lifecycle_round_trip() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let owner_email = format!("owner-{salt}@golia.test");
    let member_email = format!("member-{salt}@golia.test");
    let org_slug = format!("org-ar-{salt}");

    let owner = register(&addr, &pool, &owner_email).await;
    let member = register(&addr, &pool, &member_email).await;

    // Owner creates org.
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &owner)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();

    // Member joins as plain member directly.
    let org_id: Uuid = sqlx::query_scalar("SELECT id FROM orgs WHERE slug = $1")
        .bind(&org_slug)
        .fetch_one(&pool)
        .await
        .unwrap();
    let member_id: Uuid = sqlx::query_scalar("SELECT id FROM users WHERE email = $1")
        .bind(&member_email)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'member')")
        .bind(org_id)
        .bind(member_id)
        .execute(&pool)
        .await
        .unwrap();

    // Member trying to create → 403.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &member)
        .json(&json!({
            "name": "blocked",
            "triggerKind": "new_issue",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);

    // Owner creates a rule.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &owner)
        .json(&json!({
            "name": "Page on regression",
            "triggerKind": "regression",
            "filterConfig": { "environment": "prod" },
            "channels": [{ "type": "email", "to": ["oncall@example.com"] }],
            "throttleMinutes": 30,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201, "owner create: {}", r.text().await.unwrap());
    let rule_id = r.json::<Value>().await.unwrap()["id"].as_str().unwrap().to_string();

    // Member can list.
    let r = Client::new()
        .get(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &member)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["name"].as_str().unwrap(), "Page on regression");
    assert_eq!(rows[0]["triggerKind"].as_str().unwrap(), "regression");
    assert_eq!(rows[0]["throttleMinutes"].as_i64().unwrap(), 30);

    // Member trying to patch → 403.
    let r = Client::new()
        .patch(format!("http://{addr}/api/orgs/{org_slug}/alert-rules/{rule_id}"))
        .header("cookie", &member)
        .json(&json!({ "enabled": false }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);

    // Owner disables it.
    let r = Client::new()
        .patch(format!("http://{addr}/api/orgs/{org_slug}/alert-rules/{rule_id}"))
        .header("cookie", &owner)
        .json(&json!({ "enabled": false, "throttleMinutes": 60 }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = Client::new()
        .get(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &owner)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rows[0]["enabled"].as_bool().unwrap(), false);
    assert_eq!(rows[0]["throttleMinutes"].as_i64().unwrap(), 60);

    // Owner deletes.
    let r = Client::new()
        .delete(format!("http://{addr}/api/orgs/{org_slug}/alert-rules/{rule_id}"))
        .header("cookie", &owner)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 204);

    // Audit captured create + patch + delete.
    let actions: Vec<String> = sqlx::query_scalar(
        "SELECT action FROM audit_logs WHERE org_id = $1 AND target_type = 'alert_rule' \
         ORDER BY created_at",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(actions, vec![
        "alert_rule.created".to_string(),
        "alert_rule.patched".to_string(),
        "alert_rule.deleted".to_string(),
    ]);
}

#[tokio::test]
async fn rule_validation_rejects_garbage() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("vbad-{salt}@golia.test");
    let org_slug = format!("org-arv-{salt}");
    let cookie = register(&addr, &pool, &email).await;
    Client::new()
        .post(format!("http://{addr}/api/orgs"))
        .header("cookie", &cookie)
        .json(&json!({ "slug": org_slug, "name": org_slug }))
        .send()
        .await
        .unwrap();

    // Unknown trigger.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({ "name": "x", "triggerKind": "explosive" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // Channels not array.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "x", "triggerKind": "new_issue", "channels": { "not": "array" }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // Empty name.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({ "name": "  ", "triggerKind": "new_issue" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // Throttle out of range.
    let r = Client::new()
        .post(format!("http://{addr}/api/orgs/{org_slug}/alert-rules"))
        .header("cookie", &cookie)
        .json(&json!({
            "name": "x", "triggerKind": "new_issue", "throttleMinutes": 99999999
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
}
