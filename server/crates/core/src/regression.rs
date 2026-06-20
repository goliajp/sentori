// Phase 23 sub-D: regression sweeper.
//
// Primary regression detection happens in `issues::upsert_issue` —
// the ON CONFLICT UPDATE flips `resolved → regressed` atomically the
// instant a fresh event lands. This task is a **safety net** that
// catches rows the ingest path missed:
//
//   - Pre-existing issues whose `last_seen` advanced before sub-D's
//     migration ran (rows already had events post-resolve but the
//     status column never moved).
//   - DB writes that happened through a code path bypassing the upsert
//     (e.g. backfill scripts, future direct UPDATE statements).
//   - Edge case: `last_seen > resolved_at` is the canonical "we've
//     seen events since this was resolved" signal — if status is still
//     `resolved` after that, something diverged.
//
// Runs every 5 minutes. Bounded by a partial index
// (`issues_resolved_idx WHERE status = 'resolved'`) so the scan is
// cheap regardless of total issue count.

use std::time::Duration;

use sqlx::PgPool;
use tokio::time;

const SWEEP_INTERVAL: Duration = Duration::from_secs(5 * 60);

pub fn spawn_sweeper(pool: PgPool) {
    tokio::spawn(async move {
        // Skip the first immediate fire — startup has enough to do.
        let mut ticker = time::interval_at(
            tokio::time::Instant::now() + SWEEP_INTERVAL,
            SWEEP_INTERVAL,
        );
        loop {
            ticker.tick().await;
            match sweep(&pool).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(rows = n, "regression sweeper flipped resolved → regressed"),
                Err(e) => tracing::warn!(error = %e, "regression sweep failed"),
            }
        }
    });
}

/// Flip every row where `status = 'resolved' AND last_seen > resolved_at`
/// to `regressed`, stamping `regressed_at = last_seen` and
/// `regressed_in_release = last_release`. Returns the row count touched.
pub async fn sweep(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE issues SET
            status = 'regressed',
            regressed_at = last_seen,
            regressed_in_release = last_release
        WHERE status = 'resolved'
          AND resolved_at IS NOT NULL
          AND last_seen > resolved_at
        "#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}
