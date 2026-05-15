// v0.9.0 #5 — issue velocity alerts.
//
// Cron every 5 min: for each issue, compare events in the last 30 min
// vs the previous 30 min. Trip thresholds:
//   • count_now ≥ 20 AND ratio ≥ 3   → warn
//   • count_now ≥ 20 AND ratio ≥ 5   → page
// Send NotifyEvent::IssueVelocity through the standard notifier loop
// (emails out via the project's notification recipients).
//
// Dedupe via `velocity_state` table: skip if we alerted within the
// last 30 min on the same issue. Prevents an issue that crashes 500
// times an hour from spamming the channel every 5 min.

use std::time::Duration;

use anyhow::Result;
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::notifier::NotifyEvent;

const MIN_ABS: i64 = 20;
const WARN_RATIO: f64 = 3.0;
const PAGE_RATIO: f64 = 5.0;
const INTERVAL_SECS: u64 = 5 * 60;

pub fn spawn_cron(pool: PgPool, tx: mpsc::Sender<NotifyEvent>) {
    tokio::spawn(async move {
        // initial warmup so we don't fire during server cold-start churn
        tokio::time::sleep(Duration::from_secs(90)).await;
        loop {
            if let Err(e) = sweep_once(&pool, &tx).await {
                tracing::warn!(error = %e, "velocity sweep failed");
            }
            tokio::time::sleep(Duration::from_secs(INTERVAL_SECS)).await;
        }
    });
}

async fn sweep_once(pool: &PgPool, tx: &mpsc::Sender<NotifyEvent>) -> Result<()> {
    // For each issue with traffic in the last 60 min, count now / prev
    // bucket events.
    let rows: Vec<(Uuid, Uuid, String, String, i64, i64)> = sqlx::query_as(
        r#"
        WITH win AS (
            SELECT e.issue_id,
                   e.project_id,
                   COUNT(*) FILTER (WHERE e.received_at >= now() - interval '30 minutes') AS now_count,
                   COUNT(*) FILTER (
                       WHERE e.received_at <  now() - interval '30 minutes'
                         AND e.received_at >= now() - interval '60 minutes'
                   ) AS prev_count
            FROM events e
            WHERE e.received_at >= now() - interval '60 minutes'
              AND e.issue_id IS NOT NULL
            GROUP BY e.issue_id, e.project_id
        )
        SELECT win.issue_id, win.project_id, i.error_type, i.message_sample,
               win.now_count, win.prev_count
        FROM win
        JOIN issues i ON i.id = win.issue_id
        WHERE win.now_count >= $1
        "#,
    )
    .bind(MIN_ABS)
    .fetch_all(pool)
    .await?;

    for (issue_id, project_id, error_type, message_sample, now_count, prev_count) in rows {
        let ratio = if prev_count > 0 {
            now_count as f64 / prev_count as f64
        } else {
            // No previous-bucket traffic: treat as "very new". Use
            // now_count itself as a saturated ratio so 20 events out
            // of nowhere reads as ratio 20.
            now_count as f64
        };
        if ratio < WARN_RATIO {
            continue;
        }
        let level = if ratio >= PAGE_RATIO { "page" } else { "warn" };

        // Dedupe: 30 min cooldown per issue.
        let already: Option<i64> = sqlx::query_scalar(
            "SELECT 1::BIGINT FROM velocity_state \
             WHERE issue_id = $1 AND last_alert_at >= now() - interval '30 minutes' LIMIT 1",
        )
        .bind(issue_id)
        .fetch_optional(pool)
        .await?;
        if already.is_some() {
            continue;
        }

        sqlx::query(
            "INSERT INTO velocity_state (issue_id, last_alert_at, last_alert_ratio, last_alert_count, level) \
             VALUES ($1, now(), $2, $3, $4) \
             ON CONFLICT (issue_id) DO UPDATE SET \
                 last_alert_at = excluded.last_alert_at, \
                 last_alert_ratio = excluded.last_alert_ratio, \
                 last_alert_count = excluded.last_alert_count, \
                 level = excluded.level",
        )
        .bind(issue_id)
        .bind(ratio)
        .bind(now_count as i32)
        .bind(level)
        .execute(pool)
        .await?;

        let _ = tx
            .send(NotifyEvent::IssueVelocity {
                project_id,
                issue_id,
                error_type,
                message_sample,
                now_count,
                prev_count,
                ratio,
                level: level.to_string(),
            })
            .await;
    }
    Ok(())
}
