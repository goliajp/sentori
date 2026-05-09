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
    let app = router::build(
        TOKEN.to_string(),
        Some(pool.clone()),
        seed::DEV_PROJECT_ID,
    );

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    Some((addr, pool))
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
async fn five_duplicates_create_one_issue_and_five_events() {
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
}
