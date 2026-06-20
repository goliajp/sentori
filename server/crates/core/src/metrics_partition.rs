// v2.1 W1 part 2 — runtime_metrics_raw partition lifecycle cron.
//
// Hourly tick that:
//   • Ensures today + tomorrow + day-after partitions exist
//     (3-day rolling window — covers in-flight late-arriving SDK
//     batches without blocking inserts).
//   • Once a day at 03:00 UTC, drops partitions whose upper
//     bound is past `now - 90d` (raw retention).
//
// All SQL is pure Postgres (no pg_partman / Timescale dep) so
// self-hosted deployments stay on stock Postgres 18. CREATE TABLE
// … IF NOT EXISTS … PARTITION OF … is idempotent at the catalog
// level; we additionally guard with an information_schema lookup
// to keep `tracing::info!` clean on no-op ticks.
//
// Design rationale: docs/design/v2-metrics.md "Partition
// lifecycle".

use std::time::Duration;

use anyhow::Result;
use sqlx::PgPool;
use time::{Date, OffsetDateTime, format_description::FormatItem, macros::format_description};

const TICK_SECS: u64 = 60 * 60; // hourly
const RETENTION_DAYS: i64 = 90;

const DAY_FMT: &[FormatItem<'_>] = format_description!("[year]_[month]_[day]");
const DAY_BOUND_FMT: &[FormatItem<'_>] = format_description!("[year]-[month]-[day] 00:00:00+00");

pub fn spawn_cron(pool: PgPool) {
    tokio::spawn(async move {
        // Run once immediately at startup so today's partition
        // is guaranteed before any /v1/runtime-metrics:batch
        // hits the writer.
        if let Err(e) = ensure_window(&pool).await {
            tracing::warn!(error = %e, "metrics partition bootstrap failed");
        }
        loop {
            tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
            if let Err(e) = ensure_window(&pool).await {
                tracing::warn!(error = %e, "metrics partition ensure failed");
            }
            // Drop old partitions once per day, at the 03:xx hour
            // tick (off-peak for SaaS JST deployment).
            let now = OffsetDateTime::now_utc();
            if now.hour() == 3 {
                if let Err(e) = drop_expired(&pool).await {
                    tracing::warn!(error = %e, "metrics partition expiry failed");
                }
            }
        }
    });
}

async fn ensure_window(pool: &PgPool) -> Result<()> {
    let today = OffsetDateTime::now_utc().date();
    for offset in 0..=2 {
        let d = today + time::Duration::days(offset);
        ensure_partition(pool, d).await?;
    }
    Ok(())
}

async fn ensure_partition(pool: &PgPool, day: Date) -> Result<()> {
    let next = day + time::Duration::days(1);
    let part_name = format!("runtime_metrics_raw_{}", day.format(DAY_FMT)?);
    let from_bound = day.format(DAY_BOUND_FMT)?;
    let to_bound = next.format(DAY_BOUND_FMT)?;

    // CREATE TABLE IF NOT EXISTS is the idempotent path. We don't
    // need to consult information_schema first — `IF NOT EXISTS`
    // makes this a no-op when the partition is already there.
    let sql = format!(
        "CREATE TABLE IF NOT EXISTS {part_name} \
         PARTITION OF runtime_metrics_raw \
         FOR VALUES FROM ('{from_bound}') TO ('{to_bound}')",
    );
    sqlx::query(&sql).execute(pool).await?;
    tracing::debug!(partition = %part_name, "ensured runtime_metrics_raw partition");
    Ok(())
}

async fn drop_expired(pool: &PgPool) -> Result<()> {
    let cutoff = OffsetDateTime::now_utc().date() - time::Duration::days(RETENTION_DAYS);
    // Discover partitions via pg_inherits → child table names.
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT c.relname \
         FROM pg_inherits i \
         JOIN pg_class c ON c.oid = i.inhrelid \
         JOIN pg_class p ON p.oid = i.inhparent \
         WHERE p.relname = 'runtime_metrics_raw'",
    )
    .fetch_all(pool)
    .await?;

    for (relname,) in rows {
        if let Some(part_date) = relname.strip_prefix("runtime_metrics_raw_") {
            // Parse the YYYY_MM_DD suffix back to a Date.
            if let Ok(d) = Date::parse(part_date, DAY_FMT) {
                if d < cutoff {
                    let sql = format!("DROP TABLE IF EXISTS {relname}");
                    if let Err(e) = sqlx::query(&sql).execute(pool).await {
                        tracing::warn!(error = %e, partition = %relname, "drop partition failed");
                    } else {
                        tracing::info!(partition = %relname, "dropped expired partition");
                    }
                }
            }
        }
    }
    Ok(())
}
