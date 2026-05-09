// Phase 15: per-org plan + quota + usage rollup.
//
// Defaults defined here so create_org / bootstrap_personal_org can write
// a sensible row when an org is born; later phases add admin-API
// mutations to upgrade plans.

use redis::AsyncCommands;
use sqlx::{Executor, PgPool, Postgres};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

pub const FREE_EVENT_LIMIT_MONTHLY: i32 = 100_000;
pub const FREE_RETENTION_DAYS: i32 = 30;

/// Insert the free-tier quota row for `org_id`. Idempotent — safe to
/// run on every create-org path; existing rows survive untouched.
pub async fn ensure_default_quota<'e, E>(executor: E, org_id: Uuid) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(
        "INSERT INTO org_quotas (org_id, plan, event_limit_monthly, retention_days) \
         VALUES ($1, 'free', $2, $3) \
         ON CONFLICT (org_id) DO NOTHING",
    )
    .bind(org_id)
    .bind(FREE_EVENT_LIMIT_MONTHLY)
    .bind(FREE_RETENTION_DAYS)
    .execute(executor)
    .await?;
    Ok(())
}

/// Period key for the usage_counters PK and the Valkey counter.
/// Format: YYYYMM in UTC, e.g. "202605".
pub fn period_key(now: OffsetDateTime) -> String {
    let utc = now.to_offset(time::UtcOffset::UTC);
    format!("{:04}{:02}", utc.year(), u8::from(utc.month()))
}

/// First instant of the next UTC month — when the org's monthly quota
/// resets. Used in the 429 response body and the dashboard banner.
pub fn next_period_start(now: OffsetDateTime) -> OffsetDateTime {
    let utc = now.to_offset(time::UtcOffset::UTC);
    let y = utc.year();
    let m = u8::from(utc.month());
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let next = time::Date::from_calendar_date(ny, time::Month::try_from(nm).unwrap(), 1)
        .expect("valid first-of-month");
    next.with_hms(0, 0, 0)
        .expect("midnight is valid")
        .assume_utc()
}

const COUNTER_TTL: Duration = Duration::days(32);

/// Outcome of a per-event quota gate. The Allowed branch returns the
/// count *after* incrementing so callers can include "X used / Y" in
/// telemetry; Exceeded does not increment usage but does increment the
/// dropped counter.
#[derive(Debug)]
pub enum QuotaDecision {
    Allowed { current: u64, limit: i32 },
    Exceeded { current: u64, limit: i32, reset_at: OffsetDateTime },
}

/// Phase 15 sub-B: ingest quota gate.
///   1. Look up the org's monthly limit from `org_quotas`. Missing row →
///      treated as the free-tier default so newly created orgs don't
///      race the create_org tx.
///   2. Read the current count from Valkey `usage:<org_id>:<period>`.
///   3. If count >= limit → INCR dropped counter, return Exceeded.
///   4. Otherwise INCR the usage counter (set TTL on first write) and
///      return Allowed with the new total.
///
/// Errors propagate up; callers fail-open (admit the event) on Err so a
/// transient Valkey blip doesn't drop legit traffic.
pub async fn check_and_record(
    pool: &PgPool,
    valkey: redis::aio::ConnectionManager,
    org_id: Uuid,
    now: OffsetDateTime,
) -> Result<QuotaDecision, anyhow::Error> {
    let limit: i32 = sqlx::query_scalar(
        "SELECT event_limit_monthly FROM org_quotas WHERE org_id = $1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(FREE_EVENT_LIMIT_MONTHLY);

    let period = period_key(now);
    let usage_key = format!("usage:{org_id}:{period}");
    let dropped_key = format!("dropped:{org_id}:{period}");
    let mut conn = valkey;

    let current: u64 = conn.get(&usage_key).await.unwrap_or(0);
    let limit_u64 = limit.max(0) as u64;
    if current >= limit_u64 {
        let _: u64 = conn.incr(&dropped_key, 1u64).await?;
        let _: () = conn.expire(&dropped_key, COUNTER_TTL.whole_seconds()).await?;
        return Ok(QuotaDecision::Exceeded {
            current,
            limit,
            reset_at: next_period_start(now),
        });
    }

    let new_count: u64 = conn.incr(&usage_key, 1u64).await?;
    if new_count == 1 {
        let _: () = conn.expire(&usage_key, COUNTER_TTL.whole_seconds()).await?;
    }
    Ok(QuotaDecision::Allowed { current: new_count, limit })
}

/// Spawn the periodic Valkey → PG rollup. Reads the live counters once
/// a minute and UPSERTs `usage_counters` so the dashboard / billing /
/// monthly cron always sees a fresh snapshot, and the data survives a
/// Valkey restart with at most one minute of loss.
pub fn spawn_flush_task(
    pool: PgPool,
    valkey: redis::aio::ConnectionManager,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        // Wait a few seconds so the server is fully up before the first
        // fan-out, then flush every 60s thereafter.
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            if let Err(e) = flush_once(&pool, valkey.clone()).await {
                tracing::error!(error = %e, "quota flush failed");
            }
        }
    })
}

async fn flush_once(
    pool: &PgPool,
    mut conn: redis::aio::ConnectionManager,
) -> Result<(), anyhow::Error> {
    let now = OffsetDateTime::now_utc();
    let period = period_key(now);
    let orgs: Vec<Uuid> = sqlx::query_scalar("SELECT org_id FROM org_quotas")
        .fetch_all(pool)
        .await?;
    let mut updated = 0usize;
    for org_id in orgs {
        let used: u64 = conn
            .get(format!("usage:{org_id}:{period}"))
            .await
            .unwrap_or(0);
        let dropped: u64 = conn
            .get(format!("dropped:{org_id}:{period}"))
            .await
            .unwrap_or(0);
        if used == 0 && dropped == 0 {
            continue;
        }
        sqlx::query(
            "INSERT INTO usage_counters (org_id, period_yyyymm, event_count, dropped_count) \
             VALUES ($1, $2, $3, $4) \
             ON CONFLICT (org_id, period_yyyymm) DO UPDATE SET \
               event_count = EXCLUDED.event_count, \
               dropped_count = EXCLUDED.dropped_count, \
               updated_at = now()",
        )
        .bind(org_id)
        .bind(&period)
        .bind(used as i64)
        .bind(dropped as i64)
        .execute(pool)
        .await?;
        updated += 1;
    }
    if updated > 0 {
        tracing::debug!(updated, "quota counters flushed");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn period_key_formats_yyyymm() {
        assert_eq!(period_key(datetime!(2026-05-09 12:34 UTC)), "202605");
        assert_eq!(period_key(datetime!(2026-01-01 00:00 UTC)), "202601");
        assert_eq!(period_key(datetime!(2026-12-31 23:59 UTC)), "202612");
    }

    #[test]
    fn next_period_start_handles_year_rollover() {
        assert_eq!(
            next_period_start(datetime!(2026-12-31 23:59 UTC)),
            datetime!(2027-01-01 00:00 UTC),
        );
        assert_eq!(
            next_period_start(datetime!(2026-05-09 12:34 UTC)),
            datetime!(2026-06-01 00:00 UTC),
        );
    }
}
