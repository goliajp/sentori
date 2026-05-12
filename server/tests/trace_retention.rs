// Phase 39 sub-C: traces pruning. Skips cleanly when DATABASE_URL
// isn't set. Only exercises `prune_traces` (a plain DELETE) — the
// partition-drop path is structurally the events one (already in
// prod) plus unit-tested name parsing, so we don't run the global
// `run_once` here.

use sentori_server::{db, retention, seed};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn setup() -> Option<PgPool> {
    let url = std::env::var("DATABASE_URL").ok()?;
    let pool = db::connect(&url).await.ok()?;
    seed::ensure_dev_project(&pool).await.ok()?;
    Some(pool)
}

async fn insert_trace(pool: &PgPool, id: Uuid, last_seen: OffsetDateTime) {
    sqlx::query(
        "INSERT INTO traces (trace_id, project_id, root_op, root_name, first_seen, last_seen, span_count, status, duration_ms) \
         VALUES ($1, $2, 'http.client', 'GET /x', $3, $3, 1, 'ok', 5)",
    )
    .bind(id)
    .bind(seed::DEV_PROJECT_ID)
    .bind(last_seen)
    .execute(pool)
    .await
    .expect("insert trace");
}

async fn exists(pool: &PgPool, id: Uuid) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT count(*) FROM traces WHERE trace_id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("count")
        > 0
}

#[tokio::test]
async fn prune_traces_drops_only_rows_older_than_cutoff() {
    let Some(pool) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let now = OffsetDateTime::now_utc();
    let old_id = Uuid::now_v7();
    let fresh_id = Uuid::now_v7();
    insert_trace(&pool, old_id, now - Duration::days(100)).await;
    insert_trace(&pool, fresh_id, now).await;

    let cutoff = now - Duration::days(14);
    let deleted = retention::prune_traces(&pool, cutoff).await.expect("prune");
    assert!(deleted >= 1, "should have deleted at least the 100-day-old row");

    assert!(!exists(&pool, old_id).await, "100-day-old trace should be gone");
    assert!(exists(&pool, fresh_id).await, "today's trace should remain");

    // cleanup
    sqlx::query("DELETE FROM traces WHERE trace_id = $1")
        .bind(fresh_id)
        .execute(&pool)
        .await
        .ok();
}
