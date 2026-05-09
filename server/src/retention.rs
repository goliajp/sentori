// Phase 15 sub-section C: events-partition lifecycle.
//
// Two responsibilities, run together once a day:
//   1. ensure_future_partitions  — keep N months of empty partitions
//      ahead of "now" so writes never spill into events_default.
//   2. drop_expired_partitions   — drop any monthly partition whose
//      upper bound is older than `max(retention_days)` across all
//      orgs (today everything is free-tier 30d; pro/enterprise plans
//      will lengthen this in Phase 16+).

use std::collections::HashSet;

use sqlx::PgPool;
use time::{Date, Duration, Month, OffsetDateTime};

const FUTURE_MONTHS: u32 = 6;
/// Single name validation, used twice: regex in SQL + parse here.
const PARTITION_RE: &str = r"^events_[0-9]{4}_[0-9]{2}$";

pub fn spawn_retention_task(pool: PgPool) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        // Slight delay so server-start logs aren't intermingled with
        // partition-management chatter.
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        loop {
            if let Err(e) = run_once(&pool).await {
                tracing::error!(error = %e, "retention pass failed");
            }
            tokio::time::sleep(std::time::Duration::from_secs(60 * 60 * 24)).await;
        }
    })
}

pub async fn run_once(pool: &PgPool) -> Result<RetentionStats, anyhow::Error> {
    let now = OffsetDateTime::now_utc();
    let created = ensure_future_partitions(pool, now, FUTURE_MONTHS).await?;
    let max_days: i32 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(retention_days), 30)::int4 FROM org_quotas",
    )
    .fetch_one(pool)
    .await?;
    let cutoff = now - Duration::days(max_days as i64);
    let dropped = drop_expired_partitions(pool, cutoff).await?;
    if created > 0 || dropped > 0 {
        tracing::info!(created, dropped, max_days, "retention pass complete");
    }
    Ok(RetentionStats { created, dropped, max_days })
}

#[derive(Debug)]
pub struct RetentionStats {
    pub created: u32,
    pub dropped: u32,
    pub max_days: i32,
}

async fn ensure_future_partitions(
    pool: &PgPool,
    now: OffsetDateTime,
    months_ahead: u32,
) -> Result<u32, sqlx::Error> {
    // Snapshot existing partitions up front; CREATE TABLE's rows_affected
    // is always 0 so we can't rely on it to detect "actually created".
    let existing: HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT c.relname FROM pg_inherits i \
         JOIN pg_class p ON i.inhparent = p.oid \
         JOIN pg_class c ON i.inhrelid = c.oid \
         WHERE p.relname = 'events'",
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let mut created = 0u32;
    for offset in 0..months_ahead {
        let (y, m) = add_months(now.year(), u8::from(now.month()), offset);
        let (ny, nm) = next_month(y, m);
        let name = format!("events_{y:04}_{m:02}");
        if existing.contains(&name) {
            continue;
        }
        let from = format!("{y:04}-{m:02}-01");
        let to = format!("{ny:04}-{nm:02}-01");
        // Inputs are integers we generated, so this string interpolation is
        // injection-safe by construction.
        let sql = format!(
            "CREATE TABLE IF NOT EXISTS {name} PARTITION OF events \
             FOR VALUES FROM ('{from}') TO ('{to}')"
        );
        sqlx::query(&sql).execute(pool).await?;
        created += 1;
        tracing::info!(partition = %name, "created future partition");
    }
    Ok(created)
}

async fn drop_expired_partitions(
    pool: &PgPool,
    cutoff: OffsetDateTime,
) -> Result<u32, sqlx::Error> {
    let partitions: Vec<String> = sqlx::query_scalar(
        "SELECT c.relname FROM pg_inherits i \
         JOIN pg_class p ON i.inhparent = p.oid \
         JOIN pg_class c ON i.inhrelid = c.oid \
         WHERE p.relname = 'events' AND c.relname ~ $1",
    )
    .bind(PARTITION_RE)
    .fetch_all(pool)
    .await?;

    let mut dropped = 0u32;
    for name in partitions {
        let Some((y, m)) = parse_partition_name(&name) else {
            continue;
        };
        let (ny, nm) = next_month(y, m);
        let upper = match Date::from_calendar_date(
            ny,
            Month::try_from(nm).expect("valid month"),
            1,
        ) {
            Ok(d) => d.with_hms(0, 0, 0).expect("midnight").assume_utc(),
            Err(_) => continue,
        };
        if upper > cutoff {
            continue;
        }
        // name validated by regex + parse_partition_name; no injection vector.
        let sql = format!("DROP TABLE IF EXISTS {name}");
        sqlx::query(&sql).execute(pool).await?;
        dropped += 1;
        tracing::info!(partition = %name, "dropped expired partition");
    }
    Ok(dropped)
}

fn parse_partition_name(name: &str) -> Option<(i32, u8)> {
    let rest = name.strip_prefix("events_")?;
    let mut parts = rest.split('_');
    let y: i32 = parts.next()?.parse().ok()?;
    let m: u8 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    if (1..=12).contains(&m) { Some((y, m)) } else { None }
}

fn next_month(y: i32, m: u8) -> (i32, u8) {
    if m == 12 { (y + 1, 1) } else { (y, m + 1) }
}

fn add_months(y: i32, m: u8, offset: u32) -> (i32, u8) {
    // 1-indexed month arithmetic.
    let total = (m as u32 - 1) + offset;
    let dy = (total / 12) as i32;
    let dm = (total % 12) as u8 + 1;
    (y + dy, dm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_well_formed_names() {
        assert_eq!(parse_partition_name("events_2026_05"), Some((2026, 5)));
        assert_eq!(parse_partition_name("events_2030_12"), Some((2030, 12)));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_partition_name("events_default"), None);
        assert_eq!(parse_partition_name("events_2026_13"), None);
        assert_eq!(parse_partition_name("events_2026"), None);
        assert_eq!(parse_partition_name("events_2026_05_extra"), None);
        assert_eq!(parse_partition_name("oops_2026_05"), None);
    }

    #[test]
    fn add_months_handles_year_rollover() {
        assert_eq!(add_months(2026, 5, 0), (2026, 5));
        assert_eq!(add_months(2026, 5, 7), (2026, 12));
        assert_eq!(add_months(2026, 5, 8), (2027, 1));
        assert_eq!(add_months(2026, 12, 13), (2028, 1));
    }
}
