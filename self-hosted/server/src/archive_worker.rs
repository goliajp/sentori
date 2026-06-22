//! Background archive worker.
//!
//! Periodically (default daily) DELETEs old `sent` push_sends + their
//! delivery_logs to keep the table small. Keeps `failed` indefinitely
//! by default (operator may want to investigate later) — controllable.
//!
//! Tunables:
//! - `SENTORI_ARCHIVE_WORKER_ENABLED` default on
//! - `SENTORI_ARCHIVE_INTERVAL_SEC` default 86400 (24h)
//! - `SENTORI_ARCHIVE_SENT_DAYS`    default 30
//! - `SENTORI_ARCHIVE_FAILED_DAYS`  default 90

use std::time::Duration;

use sqlx::PgPool;
use tokio::time::sleep;
use tracing::{info, warn};

pub fn spawn(pool: PgPool) {
    if !env_enabled() {
        info!("archive worker disabled via SENTORI_ARCHIVE_WORKER_ENABLED");
        return;
    }
    let interval = env_interval();
    let sent_days = env_sent_days();
    let failed_days = env_failed_days();
    tokio::spawn(async move {
        info!(
            interval_sec = interval.as_secs(),
            sent_days, failed_days, "archive worker started"
        );
        loop {
            match run_once(&pool, sent_days, failed_days).await {
                Ok((sends, logs)) => info!(sends, logs, "archive worker pass"),
                Err(e) => warn!(error = %e, "archive worker pass failed"),
            }
            sleep(interval).await;
        }
    });
}

async fn run_once(
    pool: &PgPool,
    sent_days: i32,
    failed_days: i32,
) -> Result<(u64, u64), sqlx::Error> {
    // Delete logs first (FK), then sends.
    let logs = sqlx::query(
        "DELETE FROM push_delivery_logs WHERE send_id IN ( \
            SELECT id FROM push_sends \
            WHERE (status = 'sent' AND created_at < now() - ($1 || ' days')::interval) \
               OR (status = 'failed' AND created_at < now() - ($2 || ' days')::interval) \
         )",
    )
    .bind(sent_days)
    .bind(failed_days)
    .execute(pool)
    .await?
    .rows_affected();

    let sends = sqlx::query(
        "DELETE FROM push_sends WHERE \
            (status = 'sent' AND created_at < now() - ($1 || ' days')::interval) \
            OR (status = 'failed' AND created_at < now() - ($2 || ' days')::interval)",
    )
    .bind(sent_days)
    .bind(failed_days)
    .execute(pool)
    .await?
    .rows_affected();

    Ok((sends, logs))
}

fn env_enabled() -> bool {
    matches!(
        std::env::var("SENTORI_ARCHIVE_WORKER_ENABLED")
            .ok()
            .as_deref()
            .map(|s| s.to_ascii_lowercase()),
        Some(s) if s == "1" || s == "true"
    ) || std::env::var("SENTORI_ARCHIVE_WORKER_ENABLED").is_err()
}

fn env_interval() -> Duration {
    let secs = std::env::var("SENTORI_ARCHIVE_INTERVAL_SEC")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(86400);
    Duration::from_secs(secs)
}

fn env_sent_days() -> i32 {
    std::env::var("SENTORI_ARCHIVE_SENT_DAYS")
        .ok()
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(30)
}

fn env_failed_days() -> i32 {
    std::env::var("SENTORI_ARCHIVE_FAILED_DAYS")
        .ok()
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(90)
}
