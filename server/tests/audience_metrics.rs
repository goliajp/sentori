// v1.1 chunk C — Audience metrics aggregation correctness.
//
// Seeds the per-test project with a small synthetic stream:
//   - 3 distinct users across 2 days
//   - 5 pageviews, 2 custom track events
//   - 1 error event in the events table
// Then hits /admin/api/projects/{id}/audience/metrics and asserts:
//   - day-bucketed counts match the seeded shape
//   - totals match the per-bucket sums
//   - unique-user dedup is per-day, not per-bucket

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
        dev_token: "st_pk_aud00000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "aud".to_string(),
        session_secret: "aud-secret".to_string(),
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

async fn project_with_cookie(addr: &SocketAddr, pool: &PgPool) -> (Uuid, String) {
    let suffix = Uuid::now_v7().simple().to_string();
    let salt = &suffix[12..28];
    let email = format!("aud-{salt}@golia.test");
    let org_slug = format!("org-a-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-aud-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-aud-1234" }))
        .send()
        .await
        .unwrap();
    let cookie = login
        .headers()
        .get_all("set-cookie")
        .iter()
        .find_map(|v| {
            v.to_str()
                .ok()
                .and_then(|s| s.split(';').next())
                .map(str::to_string)
        })
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
        .json(&json!({ "name": "audp" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    let project_id = Uuid::parse_str(proj["id"].as_str().unwrap()).unwrap();
    (project_id, cookie)
}

#[tokio::test]
async fn audience_metrics_aggregates_track_and_events() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_with_cookie(&addr, &pool).await;

    // Seed track_events: 3 distinct users, day -2 + day -1.
    // Day -2: u1 → 1 pageview, 1 custom; u2 → 1 pageview.
    // Day -1: u1 → 1 pageview; u3 → 2 pageviews, 1 custom.
    let day_minus_2 = "2026-05-15T10:00:00Z";
    let day_minus_1 = "2026-05-16T11:00:00Z";

    let seeds = [
        (day_minus_2, "u1", "$pageview"),
        (day_minus_2, "u1", "added_to_cart"),
        (day_minus_2, "u2", "$pageview"),
        (day_minus_1, "u1", "$pageview"),
        (day_minus_1, "u3", "$pageview"),
        (day_minus_1, "u3", "$pageview"),
        (day_minus_1, "u3", "checkout_started"),
    ];
    for (ts, user, name) in &seeds {
        sqlx::query(
            "INSERT INTO track_events (id, project_id, name, user_id, props, occurred_at) \
             VALUES ($1, $2, $3, $4, '{}'::jsonb, $5::timestamptz)",
        )
        .bind(Uuid::now_v7())
        .bind(project_id)
        .bind(name)
        .bind(user)
        .bind(ts)
        .execute(&pool)
        .await
        .unwrap();
    }
    // One event in events table on day -1.
    sqlx::query(
        "INSERT INTO events (id, project_id, occurred_at, platform, release, environment, \
                             error_type, error_message, payload) \
         VALUES ($1, $2, $3::timestamptz, 'javascript', 'app@1', 'prod', 'TypeError', 'oops', '{}'::jsonb)",
    )
    .bind(Uuid::now_v7())
    .bind(project_id)
    .bind(day_minus_1)
    .execute(&pool)
    .await
    .unwrap();

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/audience/metrics\
             ?since=2026-05-14T00:00:00Z&until=2026-05-17T00:00:00Z&granularity=day"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "metrics 200: {}", r.text().await.unwrap());
    let body: Value = r.json().await.unwrap();

    let buckets = body["buckets"].as_array().expect("buckets");
    // Expect exactly two buckets — day -2 and day -1.
    assert_eq!(buckets.len(), 2);

    let day2 = &buckets[0];
    assert_eq!(day2["dau"].as_i64(), Some(2)); // u1 + u2
    assert_eq!(day2["pageviews"].as_i64(), Some(2));
    assert_eq!(day2["trackEvents"].as_i64(), Some(3));
    assert_eq!(day2["errors"].as_i64(), Some(0));

    let day1 = &buckets[1];
    assert_eq!(day1["dau"].as_i64(), Some(2)); // u1 + u3 (per-day dedup)
    assert_eq!(day1["pageviews"].as_i64(), Some(3));
    assert_eq!(day1["trackEvents"].as_i64(), Some(4));
    assert_eq!(day1["errors"].as_i64(), Some(1));

    let totals = &body["totals"];
    assert_eq!(totals["uniqueUsers"].as_i64(), Some(3)); // u1, u2, u3
    assert_eq!(totals["trackEvents"].as_i64(), Some(7));
    assert_eq!(totals["pageviews"].as_i64(), Some(5));
    assert_eq!(totals["errors"].as_i64(), Some(1));
}
