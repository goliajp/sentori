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

/// Insert a trace row matching what an orphan looks like in the wild:
/// root_op / root_name are NULL (no root span ever arrived),
/// duration_ms = 0, status set by the child spans.
async fn insert_orphan(pool: &PgPool, id: Uuid, last_seen: OffsetDateTime) {
    sqlx::query(
        "INSERT INTO traces (trace_id, project_id, root_op, root_name, first_seen, last_seen, span_count, status, duration_ms) \
         VALUES ($1, $2, NULL, NULL, $3, $3, 7, 'error', 0)",
    )
    .bind(id)
    .bind(seed::DEV_PROJECT_ID)
    .bind(last_seen)
    .execute(pool)
    .await
    .expect("insert orphan");
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

#[tokio::test]
async fn prune_orphan_traces_drops_stale_orphans_only() {
    let Some(pool) = setup().await else {
        eprintln!("skipping (DATABASE_URL not set)");
        return;
    };

    let now = OffsetDateTime::now_utc();
    let fresh_orphan = Uuid::now_v7();
    let stale_orphan = Uuid::now_v7();
    let stale_with_root = Uuid::now_v7();

    // Within the 1-hour grace window — root might still be coming.
    insert_orphan(&pool, fresh_orphan, now - Duration::minutes(10)).await;
    // Past the grace window — clearly never going to get its root.
    insert_orphan(&pool, stale_orphan, now - Duration::hours(3)).await;
    // Old but has a root_op set — not an orphan, untouched by this
    // prune (would be reaped by `prune_traces` only past retention).
    insert_trace(&pool, stale_with_root, now - Duration::hours(3)).await;

    let deleted = retention::prune_orphan_traces(&pool, now).await.expect("prune");
    assert!(deleted >= 1, "should have deleted the stale orphan");

    assert!(
        exists(&pool, fresh_orphan).await,
        "orphan younger than the grace window should remain",
    );
    assert!(
        !exists(&pool, stale_orphan).await,
        "orphan past the grace window should be gone",
    );
    assert!(
        exists(&pool, stale_with_root).await,
        "row with a root_op set is not an orphan and must survive",
    );

    // cleanup
    for id in [fresh_orphan, stale_orphan, stale_with_root] {
        sqlx::query("DELETE FROM traces WHERE trace_id = $1")
            .bind(id)
            .execute(&pool)
            .await
            .ok();
    }
}
