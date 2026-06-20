// v2.1 W1 part 2 — runtime metrics rollup cron.
//
// Three cascading aggregations, owned by `tokio::spawn`s started
// from main.rs (same shape as rule_eval / velocity / digest /
// webhook_dispatch):
//   • 60 s tick: raw [now-70s, now-10s) → _1m       (hot path)
//   • hourly @ minute 03: _1m of previous hour → _1h
//   • daily  @ 03:30 UTC: _1h of previous day  → _1d
//
// 10 s safety margin on the raw → _1m window catches in-flight
// SDK batches (30 s flush cadence + transport latency) without
// double-counting. ON CONFLICT … DO UPDATE makes every tick
// idempotent — running the same range twice produces the same
// rollup rows.
//
// Schema lives in migrations 0068 / 0069; design rationale in
// docs/design/v2-metrics.md.

use std::time::Duration;

use anyhow::Result;
use sqlx::PgPool;
use time::OffsetDateTime;

const RAW_TO_1M_TICK_SECS: u64 = 60;
const RAW_LATE_MARGIN_SECS: i64 = 10;
const RAW_WINDOW_SECS: i64 = 70;

/// 60 s tick that rolls the most recent `runtime_metrics_raw`
/// window into `runtime_metrics_1m`. Also kicks off the hourly +
/// daily cascade ticks on their own schedule.
pub fn spawn_cron(pool: PgPool) {
    spawn_raw_to_1m(pool.clone());
    spawn_1m_to_1h(pool.clone());
    spawn_1h_to_1d(pool);
}

fn spawn_raw_to_1m(pool: PgPool) {
    tokio::spawn(async move {
        // Initial warmup so we don't race the partition cron on
        // server cold-start.
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            if let Err(e) = sweep_raw_to_1m(&pool).await {
                tracing::warn!(error = %e, "metrics rollup raw→1m failed");
            }
            tokio::time::sleep(Duration::from_secs(RAW_TO_1M_TICK_SECS)).await;
        }
    });
}

fn spawn_1m_to_1h(pool: PgPool) {
    tokio::spawn(async move {
        // Wake on every wall-clock minute boundary; act only when
        // it's minute 03 of an hour. Pure tick — no per-hour
        // scheduler dep, no clock-drift sensitivity.
        loop {
            let next = next_minute_after(OffsetDateTime::now_utc());
            sleep_until(next).await;
            let now = OffsetDateTime::now_utc();
            if now.minute() == 3 {
                if let Err(e) = sweep_1m_to_1h(&pool).await {
                    tracing::warn!(error = %e, "metrics rollup 1m→1h failed");
                }
            }
        }
    });
}

fn spawn_1h_to_1d(pool: PgPool) {
    tokio::spawn(async move {
        loop {
            let next = next_minute_after(OffsetDateTime::now_utc());
            sleep_until(next).await;
            let now = OffsetDateTime::now_utc();
            if now.hour() == 3 && now.minute() == 30 {
                if let Err(e) = sweep_1h_to_1d(&pool).await {
                    tracing::warn!(error = %e, "metrics rollup 1h→1d failed");
                }
            }
        }
    });
}

fn next_minute_after(t: OffsetDateTime) -> OffsetDateTime {
    // Round up to the next whole minute, +1s so we land safely
    // inside that minute (avoids the edge where now() == bucket
    // boundary and minute_of_hour reads as the previous bucket).
    let secs_to_next = 60 - t.second() as i64;
    t + time::Duration::seconds(secs_to_next + 1)
}

async fn sleep_until(target: OffsetDateTime) {
    let now = OffsetDateTime::now_utc();
    let delta = (target - now).whole_seconds().max(1) as u64;
    tokio::time::sleep(Duration::from_secs(delta)).await;
}

async fn sweep_raw_to_1m(pool: &PgPool) -> Result<()> {
    let now = OffsetDateTime::now_utc();
    let upper = now - time::Duration::seconds(RAW_LATE_MARGIN_SECS);
    let lower = now - time::Duration::seconds(RAW_WINDOW_SECS);
    let n = sqlx::query(
        "INSERT INTO runtime_metrics_1m \
            (bucket_ts, project_id, name, release, environment, device_class, \
             count, sum, avg, p50, p95, p99) \
         SELECT \
            date_trunc('minute', ts) AS bucket_ts, \
            project_id, \
            name, \
            COALESCE(release, '') AS release, \
            COALESCE(environment, '') AS environment, \
            COALESCE(device_class, '') AS device_class, \
            COUNT(*)::bigint AS count, \
            SUM(value) AS sum, \
            AVG(value) AS avg, \
            PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY value) AS p50, \
            PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY value) AS p95, \
            PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY value) AS p99 \
         FROM runtime_metrics_raw \
         WHERE ts >= $1 AND ts < $2 \
         GROUP BY 1, 2, 3, 4, 5, 6 \
         ON CONFLICT (project_id, bucket_ts, name, release, environment, device_class) \
         DO UPDATE SET \
            count = EXCLUDED.count, \
            sum   = EXCLUDED.sum, \
            avg   = EXCLUDED.avg, \
            p50   = EXCLUDED.p50, \
            p95   = EXCLUDED.p95, \
            p99   = EXCLUDED.p99",
    )
    .bind(lower)
    .bind(upper)
    .execute(pool)
    .await?
    .rows_affected();
    if n > 0 {
        tracing::debug!(rolled = n, "raw→1m rollup tick");
    }
    Ok(())
}

async fn sweep_1m_to_1h(pool: &PgPool) -> Result<()> {
    // Roll previous hour (date_trunc('hour', now() - 1h)).
    let n = sqlx::query(
        "INSERT INTO runtime_metrics_1h \
            (bucket_ts, project_id, name, release, environment, device_class, \
             count, sum, avg, p50, p95, p99) \
         SELECT \
            date_trunc('hour', bucket_ts) AS bucket_ts, \
            project_id, \
            name, \
            release, \
            environment, \
            device_class, \
            SUM(count)::bigint AS count, \
            SUM(sum) AS sum, \
            -- Re-derive avg from sum / count rather than averaging
            -- avgs (which would weight unequally across minute
            -- buckets with different counts).
            CASE WHEN SUM(count) > 0 THEN SUM(sum) / SUM(count) ELSE 0 END AS avg, \
            PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY p50) AS p50, \
            PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY p95) AS p95, \
            PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY p99) AS p99 \
         FROM runtime_metrics_1m \
         WHERE bucket_ts >= date_trunc('hour', now() - interval '1 hour') \
           AND bucket_ts <  date_trunc('hour', now()) \
         GROUP BY 1, 2, 3, 4, 5, 6 \
         ON CONFLICT (project_id, bucket_ts, name, release, environment, device_class) \
         DO UPDATE SET \
            count = EXCLUDED.count, \
            sum   = EXCLUDED.sum, \
            avg   = EXCLUDED.avg, \
            p50   = EXCLUDED.p50, \
            p95   = EXCLUDED.p95, \
            p99   = EXCLUDED.p99",
    )
    .execute(pool)
    .await?
    .rows_affected();
    tracing::info!(rolled = n, "1m→1h rollup tick");
    Ok(())
}

async fn sweep_1h_to_1d(pool: &PgPool) -> Result<()> {
    let n = sqlx::query(
        "INSERT INTO runtime_metrics_1d \
            (bucket_ts, project_id, name, release, environment, device_class, \
             count, sum, avg, p50, p95, p99) \
         SELECT \
            date_trunc('day', bucket_ts) AS bucket_ts, \
            project_id, \
            name, \
            release, \
            environment, \
            device_class, \
            SUM(count)::bigint AS count, \
            SUM(sum) AS sum, \
            CASE WHEN SUM(count) > 0 THEN SUM(sum) / SUM(count) ELSE 0 END AS avg, \
            PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY p50) AS p50, \
            PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY p95) AS p95, \
            PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY p99) AS p99 \
         FROM runtime_metrics_1h \
         WHERE bucket_ts >= date_trunc('day', now() - interval '1 day') \
           AND bucket_ts <  date_trunc('day', now()) \
         GROUP BY 1, 2, 3, 4, 5, 6 \
         ON CONFLICT (project_id, bucket_ts, name, release, environment, device_class) \
         DO UPDATE SET \
            count = EXCLUDED.count, \
            sum   = EXCLUDED.sum, \
            avg   = EXCLUDED.avg, \
            p50   = EXCLUDED.p50, \
            p95   = EXCLUDED.p95, \
            p99   = EXCLUDED.p99",
    )
    .execute(pool)
    .await?
    .rows_affected();
    tracing::info!(rolled = n, "1h→1d rollup tick");
    Ok(())
}
