// Phase 26 sub-A: session ping ingest tests.
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
        dev_token: "st_pk_sessions00000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "sess".to_string(),
        session_secret: "sess-secret".to_string(),
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

async fn project_with_token(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("sess-{salt}@golia.test");
    let org_slug = format!("org-s-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-sess-1234" }))
        .send()
        .await
        .unwrap();
    let token: String = sqlx::query_scalar(
        "SELECT ev.token FROM email_verifications ev \
         JOIN users u ON u.id = ev.user_id WHERE u.email = $1",
    )
    .bind(&email)
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
        .json(&json!({ "email": email, "password": "pw-sess-1234" }))
        .send()
        .await
        .unwrap();
    let cookie = login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| v.to_str().ok().and_then(|s| s.split(';').next()).map(str::to_string))
        .unwrap();

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
    (project_id, tok["token"].as_str().unwrap().to_string())
}

#[tokio::test]
async fn session_ingest_round_trip() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token) = project_with_token(&addr, &pool).await;

    let sid = Uuid::now_v7();
    let r = Client::new()
        .post(format!("http://{addr}/v1/sessions"))
        .bearer_auth(&token)
        .json(&json!({
            "id": sid,
            "userId": "u_abc",
            "release": "myapp@1.0.0",
            "environment": "prod",
            "status": "ok",
            "startedAt": "2026-05-10T12:00:00Z",
            "durationMs": 4500,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 202, "session 202: {}", r.text().await.unwrap());

    let row: (String, String, String, String, i32) = sqlx::query_as(
        "SELECT user_id, release, environment, status, duration_ms \
         FROM sessions WHERE id = $1 AND project_id = $2",
    )
    .bind(sid)
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "u_abc");
    assert_eq!(row.1, "myapp@1.0.0");
    assert_eq!(row.2, "prod");
    assert_eq!(row.3, "ok");
    assert_eq!(row.4, 4500);
}

#[tokio::test]
async fn session_replay_is_idempotent() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, token) = project_with_token(&addr, &pool).await;

    let sid = Uuid::now_v7();
    let body = json!({
        "id": sid,
        "userId": null,
        "release": "myapp@2.0.0",
        "environment": "staging",
        "status": "crashed",
        "startedAt": "2026-05-10T12:00:00Z",
        "durationMs": 1000,
    });
    for _ in 0..3 {
        let r = Client::new()
            .post(format!("http://{addr}/v1/sessions"))
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 202);
    }
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE id = $1 AND project_id = $2")
            .bind(sid)
            .bind(project_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1, "duplicate ids stay at one row");
}

#[tokio::test]
async fn session_rejects_bad_input() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (_project_id, token) = project_with_token(&addr, &pool).await;

    // Missing token → 401.
    let r = Client::new()
        .post(format!("http://{addr}/v1/sessions"))
        .json(&json!({ "id": Uuid::now_v7(), "release": "x", "environment": "p", "status": "ok",
                       "startedAt": "2026-05-10T12:00:00Z", "durationMs": 0 }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);

    // Invalid status.
    let r = Client::new()
        .post(format!("http://{addr}/v1/sessions"))
        .bearer_auth(&token)
        .json(&json!({
            "id": Uuid::now_v7(), "release": "myapp@1", "environment": "prod",
            "status": "explosive", "startedAt": "2026-05-10T12:00:00Z", "durationMs": 0,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // Negative duration.
    let r = Client::new()
        .post(format!("http://{addr}/v1/sessions"))
        .bearer_auth(&token)
        .json(&json!({
            "id": Uuid::now_v7(), "release": "myapp@1", "environment": "prod",
            "status": "ok", "startedAt": "2026-05-10T12:00:00Z", "durationMs": -1,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);

    // > 1 week duration → reject (clock skew).
    let r = Client::new()
        .post(format!("http://{addr}/v1/sessions"))
        .bearer_auth(&token)
        .json(&json!({
            "id": Uuid::now_v7(), "release": "myapp@1", "environment": "prod",
            "status": "ok", "startedAt": "2026-05-10T12:00:00Z",
            "durationMs": 14u64 * 24 * 60 * 60 * 1000,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
}
