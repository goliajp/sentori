use std::net::SocketAddr;

use sentori_server::{db, router, seed};
use serde_json::json;
use sqlx::PgPool;
use tokio::net::TcpListener;

const TOKEN: &str = "st_pk_dbtest00000000000000000000";

async fn setup() -> Option<(SocketAddr, PgPool)> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    seed::ensure_dev_project(&pool).await.ok()?;

    sqlx::query("DELETE FROM events WHERE project_id = $1")
        .bind(seed::DEV_PROJECT_ID)
        .execute(&pool)
        .await
        .ok()?;
    sqlx::query("DELETE FROM issues WHERE project_id = $1")
        .bind(seed::DEV_PROJECT_ID)
        .execute(&pool)
        .await
        .ok()?;

    let listener = TcpListener::bind("127.0.0.1:0").await.ok()?;
    let addr = listener.local_addr().ok()?;
    let app = router::build(router::ServerConfig {
        dev_token: TOKEN.to_string(),
        db: Some(pool.clone()),
        valkey: None,
        project_id: seed::DEV_PROJECT_ID,
        rate_limit_per_min: 10_000,
        admin_password: "dbtest".to_string(),
        session_secret: "dbtest-secret".to_string(),
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

const RATE_LIMIT_TOKEN: &str = "st_pk_ratelim00000000000000000";

#[tokio::test]
async fn rate_limit_returns_429_when_exceeding_threshold() {
    let valkey_url = match std::env::var("VALKEY_URL") {
        Ok(u) => u,
        Err(_) => {
            eprintln!("skip: VALKEY_URL not set");
            return;
        }
    };
    let valkey = match sentori_server::valkey::connect(&valkey_url).await {
        Ok(v) => v,
        Err(_) => {
            eprintln!("skip: cannot connect to valkey");
            return;
        }
    };

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router::build(router::ServerConfig {
        dev_token: RATE_LIMIT_TOKEN.to_string(),
        db: None,
        valkey: Some(valkey),
        project_id: seed::DEV_PROJECT_ID,
        rate_limit_per_min: 3,
        admin_password: "rl".to_string(),
        session_secret: "rl-secret".to_string(),
        notifier_tx: None,
        base_url: "http://localhost:8080".to_string(),
        metrics: None,
        self_trace: None,
    });
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let client = reqwest::Client::new();
    let event = make_event(0);

    let mut statuses = Vec::new();
    for _ in 0..6 {
        let resp = client
            .post(format!("http://{addr}/v1/events"))
            .header("Authorization", format!("Bearer {RATE_LIMIT_TOKEN}"))
            .json(&event)
            .send()
            .await
            .unwrap();
        statuses.push(resp.status().as_u16());
    }

    assert!(
        statuses.iter().any(|&s| s == 429),
        "expected 429 in {statuses:?} (limit=3, sent=6)"
    );
}

fn make_event(idx: u32) -> serde_json::Value {
    let id = format!("019508a0-0000-7777-9999-{:012x}", idx);
    json!({
        "id": id,
        "timestamp": "2026-05-09T12:00:00.000Z",
        "kind": "error",
        "platform": "javascript",
        "release": "test@1.0.0+1",
        "environment": "test",
        "device": { "os": "ios", "osVersion": "17.0" },
        "app": { "version": "1.0.0" },
        "error": {
            "type": "TestError",
            "message": "five duplicates",
            "stack": [
                { "function": "foo", "file": "bar.ts", "line": 42, "inApp": true }
            ]
        }
    })
}

#[tokio::test]
async fn duplicates_group_into_one_issue_visible_via_admin() {
    let Some((addr, pool)) = setup().await else {
        eprintln!("skip: DATABASE_URL not set");
        return;
    };

    let client = reqwest::Client::new();
    for i in 0..5 {
        let event = make_event(i);
        let resp = client
            .post(format!("http://{addr}/v1/events"))
            .header("Authorization", format!("Bearer {TOKEN}"))
            .json(&event)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 202);
    }

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let issues_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM issues WHERE project_id = $1",
    )
    .bind(seed::DEV_PROJECT_ID)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(issues_count, 1, "expected exactly one issue");

    let events_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE project_id = $1",
    )
    .bind(seed::DEV_PROJECT_ID)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(events_count, 5, "expected exactly five events");

    let issue_event_count: i64 = sqlx::query_scalar(
        "SELECT event_count FROM issues WHERE project_id = $1",
    )
    .bind(seed::DEV_PROJECT_ID)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(issue_event_count, 5, "expected issue.event_count = 5");

    let issue_id_on_event: uuid::Uuid = sqlx::query_scalar(
        "SELECT issue_id FROM events WHERE project_id = $1 LIMIT 1",
    )
    .bind(seed::DEV_PROJECT_ID)
    .fetch_one(&pool)
    .await
    .unwrap();
    let issue_id: uuid::Uuid = sqlx::query_scalar(
        "SELECT id FROM issues WHERE project_id = $1",
    )
    .bind(seed::DEV_PROJECT_ID)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        issue_id_on_event, issue_id,
        "events.issue_id should match issues.id"
    );

    // -- admin endpoints --

    // GET /admin/api/projects/:id/issues
    let resp = client
        .get(format!(
            "http://{addr}/admin/api/projects/{}/issues",
            seed::DEV_PROJECT_ID
        ))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let issues: serde_json::Value = resp.json().await.unwrap();
    let issues_arr = issues.as_array().expect("issues array");
    assert_eq!(issues_arr.len(), 1, "expected 1 issue from admin list");
    let returned_issue_id = issues_arr[0]["id"].as_str().expect("issue id");
    assert_eq!(returned_issue_id, issue_id.to_string());
    assert_eq!(issues_arr[0]["eventCount"].as_i64().unwrap(), 5);

    // GET /admin/api/projects/:id/issues/:issue_id
    let resp = client
        .get(format!(
            "http://{addr}/admin/api/projects/{}/issues/{}",
            seed::DEV_PROJECT_ID, issue_id
        ))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let issue_detail: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(issue_detail["eventCount"].as_i64().unwrap(), 5);
    assert_eq!(issue_detail["status"].as_str().unwrap(), "active");

    // GET /admin/api/projects/:id/issues/:issue_id/events
    let resp = client
        .get(format!(
            "http://{addr}/admin/api/projects/{}/issues/{}/events",
            seed::DEV_PROJECT_ID, issue_id
        ))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let events: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(events.as_array().unwrap().len(), 5);

    // 404 on unknown issue id
    let bogus_id = uuid::Uuid::now_v7();
    let resp = client
        .get(format!(
            "http://{addr}/admin/api/projects/{}/issues/{}",
            seed::DEV_PROJECT_ID, bogus_id
        ))
        .header("Authorization", format!("Bearer {TOKEN}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}
