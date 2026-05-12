// Phase 26 sub-C: health aggregate query.
//
// Seed a mix of session pings, hit the endpoint, verify summary +
// per-bucket counts. We hand-INSERT rows directly so timestamps fall
// exactly where we want (the ingest path stamps `received_at = now()`,
// which we can't anchor for assertions).

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
        dev_token: "st_pk_health0000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "h".to_string(),
        session_secret: "h-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        ..Default::default()
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Some((addr, pool))
}

async fn project_with_session(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("health-{salt}@golia.test");
    let org_slug = format!("org-h-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-health-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-health-1234" }))
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
    (project_id, cookie)
}

async fn insert_session(
    pool: &PgPool,
    project_id: Uuid,
    user_id: Option<&str>,
    release: &str,
    status: &str,
    received_at: time::OffsetDateTime,
) {
    sqlx::query(
        "INSERT INTO sessions \
            (id, project_id, user_id, release, environment, status, started_at, duration_ms, received_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(Uuid::now_v7())
    .bind(project_id)
    .bind(user_id)
    .bind(release)
    .bind("prod")
    .bind(status)
    .bind(received_at)
    .bind(0_i32)
    .bind(received_at)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn health_aggregates_buckets_and_rates() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_with_session(&addr, &pool).await;

    // Seed 5 sessions. Two users, one anon. One crashed.
    let now = time::OffsetDateTime::now_utc();
    let t = |mins: i64| now - time::Duration::minutes(mins);

    insert_session(&pool, project_id, Some("u_alice"), "myapp@1.0.0", "ok", t(60)).await;
    insert_session(&pool, project_id, Some("u_alice"), "myapp@1.0.0", "ok", t(45)).await;
    insert_session(&pool, project_id, Some("u_bob"),   "myapp@1.0.0", "errored", t(30)).await;
    insert_session(&pool, project_id, Some("u_bob"),   "myapp@1.0.0", "crashed", t(15)).await;
    insert_session(&pool, project_id, None,            "myapp@1.0.0", "ok", t(10)).await;

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/health"
        ))
        .header("cookie", &cookie)
        .query(&[("bucket", "5m")])
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "health: {}", r.text().await.unwrap());
    let body: Value = r.json().await.unwrap();

    let s = &body["summary"];
    assert_eq!(s["totalSessions"].as_i64().unwrap(), 5);
    assert_eq!(s["crashedSessions"].as_i64().unwrap(), 1);
    assert_eq!(s["erroredSessions"].as_i64().unwrap(), 1);
    // 2 distinct user_ids (alice, bob); anon doesn't count.
    assert_eq!(s["totalUsers"].as_i64().unwrap(), 2);
    assert_eq!(s["crashedUsers"].as_i64().unwrap(), 1);

    // crash-free rates: sessions = (5-1)/5 = 0.8, users = (2-1)/2 = 0.5.
    let session_rate = s["crashFreeSessionRate"].as_f64().unwrap();
    let user_rate = s["crashFreeUserRate"].as_f64().unwrap();
    assert!((session_rate - 0.8).abs() < 1e-9);
    assert!((user_rate - 0.5).abs() < 1e-9);

    // Buckets present, sums match.
    let buckets = body["buckets"].as_array().unwrap();
    let total: i64 = buckets.iter().map(|b| b["total"].as_i64().unwrap()).sum();
    assert_eq!(total, 5);
    let crashed: i64 = buckets.iter().map(|b| b["crashed"].as_i64().unwrap()).sum();
    assert_eq!(crashed, 1);
}

#[tokio::test]
async fn health_filters_by_release_and_environment() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_with_session(&addr, &pool).await;

    let now = time::OffsetDateTime::now_utc();
    let t = |mins: i64| now - time::Duration::minutes(mins);
    insert_session(&pool, project_id, Some("u_a"), "myapp@1.0.0", "ok", t(20)).await;
    insert_session(&pool, project_id, Some("u_a"), "myapp@2.0.0", "crashed", t(15)).await;

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/health"
        ))
        .header("cookie", &cookie)
        .query(&[("release", "myapp@2.0.0")])
        .send()
        .await
        .unwrap();
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["summary"]["totalSessions"].as_i64().unwrap(), 1);
    assert_eq!(body["summary"]["crashedSessions"].as_i64().unwrap(), 1);
}

#[tokio::test]
async fn health_returns_null_rates_when_empty() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_with_session(&addr, &pool).await;

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/health"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["summary"]["totalSessions"].as_i64().unwrap(), 0);
    assert!(body["summary"]["crashFreeSessionRate"].is_null());
    assert!(body["summary"]["crashFreeUserRate"].is_null());
}
