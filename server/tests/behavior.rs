// v1.1 chunk D — top-routes + user-timeline aggregations.

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
        dev_token: "st_pk_beh00000000000000000000000".to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: Uuid::nil(),
        rate_limit_per_min: 100_000,
        admin_password: "beh".to_string(),
        session_secret: "beh-secret".to_string(),
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
    let email = format!("beh-{salt}@golia.test");
    let org_slug = format!("org-d-{salt}");

    Client::new()
        .post(format!("http://{addr}/api/auth/register"))
        .json(&json!({ "email": email, "password": "pw-beh-1234" }))
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
        .json(&json!({ "email": email, "password": "pw-beh-1234" }))
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
        .json(&json!({ "name": "behp" }))
        .send()
        .await
        .unwrap();
    let proj: Value = proj_resp.json().await.unwrap();
    let project_id = Uuid::parse_str(proj["id"].as_str().unwrap()).unwrap();
    (project_id, cookie)
}

#[tokio::test]
async fn top_routes_orders_by_view_count() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_with_cookie(&addr, &pool).await;

    // 3 views on /home (2 users), 1 view on /cart (1 user)
    for (user, route) in &[
        ("u1", "/home"),
        ("u1", "/home"),
        ("u2", "/home"),
        ("u2", "/cart"),
    ] {
        sqlx::query(
            "INSERT INTO track_events (id, project_id, name, user_id, route, props, occurred_at) \
             VALUES ($1, $2, '$pageview', $3, $4, '{}'::jsonb, '2026-05-17T10:00:00Z'::timestamptz)",
        )
        .bind(Uuid::now_v7())
        .bind(project_id)
        .bind(user)
        .bind(route)
        .execute(&pool)
        .await
        .unwrap();
    }

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/audience/top-routes?since=2026-05-17T00:00:00Z"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let rows: Vec<Value> = r.json().await.unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["route"].as_str(), Some("/home"));
    assert_eq!(rows[0]["views"].as_i64(), Some(3));
    assert_eq!(rows[0]["uniqueUsers"].as_i64(), Some(2));
    assert_eq!(rows[1]["route"].as_str(), Some("/cart"));
    assert_eq!(rows[1]["views"].as_i64(), Some(1));
}

#[tokio::test]
async fn user_timeline_merges_tracks_and_errors_sorted_desc() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };
    let (project_id, cookie) = project_with_cookie(&addr, &pool).await;

    // 2 track events at 10:00 + 10:05; 1 error at 10:03.
    sqlx::query(
        "INSERT INTO track_events (id, project_id, name, user_id, route, props, occurred_at) \
         VALUES ($1, $2, '$pageview', 'u9', '/checkout', '{}'::jsonb, '2026-05-17T10:00:00Z'::timestamptz)",
    )
    .bind(Uuid::now_v7())
    .bind(project_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO track_events (id, project_id, name, user_id, props, occurred_at) \
         VALUES ($1, $2, 'paid', 'u9', '{}'::jsonb, '2026-05-17T10:05:00Z'::timestamptz)",
    )
    .bind(Uuid::now_v7())
    .bind(project_id)
    .execute(&pool)
    .await
    .unwrap();
    // error event with user.id = 'u9' nested in payload JSONB
    sqlx::query(
        "INSERT INTO events (id, project_id, occurred_at, platform, release, environment, \
                             error_type, error_message, payload) \
         VALUES ($1, $2, '2026-05-17T10:03:00Z'::timestamptz, 'javascript', 'app@1', 'prod', \
                 'TypeError', 'kaboom', $3::jsonb)",
    )
    .bind(Uuid::now_v7())
    .bind(project_id)
    .bind(r#"{"user":{"id":"u9"}}"#)
    .execute(&pool)
    .await
    .unwrap();

    let r = Client::new()
        .get(format!(
            "http://{addr}/admin/api/projects/{project_id}/users/u9/timeline?since=2026-05-17T00:00:00Z"
        ))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let entries: Vec<Value> = r.json().await.unwrap();
    assert_eq!(entries.len(), 3);
    // Newest first: paid → error → pageview.
    assert_eq!(entries[0]["source"].as_str(), Some("track"));
    assert_eq!(entries[0]["name"].as_str(), Some("paid"));
    assert_eq!(entries[1]["source"].as_str(), Some("error"));
    assert_eq!(entries[1]["errorType"].as_str(), Some("TypeError"));
    assert_eq!(entries[2]["source"].as_str(), Some("track"));
    assert_eq!(entries[2]["name"].as_str(), Some("$pageview"));
    assert_eq!(entries[2]["route"].as_str(), Some("/checkout"));
}
