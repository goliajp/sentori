// Phase 15: per-org plan + quota + usage rollup.
//
// Defaults defined here so create_org / bootstrap_personal_org can write
// a sensible row when an org is born; later phases add admin-API
// mutations to upgrade plans.

use sqlx::Executor;
use sqlx::Postgres;
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
pub fn period_key(now: time::OffsetDateTime) -> String {
    let utc = now.to_offset(time::UtcOffset::UTC);
    format!("{:04}{:02}", utc.year(), u8::from(utc.month()))
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
}
