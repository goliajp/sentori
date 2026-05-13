// Partition / row lifecycle, run once a day.
//
// Per partitioned table (events, spans):
//   1. ensure_future_partitions — keep N months of empty monthly
//      partitions ahead of "now" so writes never spill into the
//      DEFAULT partition.
//   2. drop_expired_partitions — drop any monthly partition whose
//      upper bound is older than that table's retention cutoff.
//
// For traces (not partitioned — see migration 0029): a plain
// DELETE WHERE last_seen < cutoff using traces_last_seen_idx.
//
// Retention cutoffs:
//   - events: max(retention_days) across org_quotas, floor 30.
//     Errors are high-value; plans lengthen this.
//   - spans + traces: SENTORI_TRACE_RETENTION_DAYS (default 14).
//     Traces are high-volume / lower-value than errors — a short
//     hard window keeps storage bounded; recent traces stay 100%
//     complete (we don't sample at ingest).

use std::collections::HashSet;

use sqlx::PgPool;
use time::{Date, Duration, Month, OffsetDateTime};

const FUTURE_MONTHS: u32 = 6;
const EVENTS_RETENTION_FLOOR_DAYS: i64 = 30;
const DEFAULT_TRACE_RETENTION_DAYS: i64 = 14;
/// Tables this task manages monthly partitions for.
const PARTITIONED_TABLES: &[&str] = &["events", "spans"];
/// How long after the last child span before an orphan trace
/// (root_op IS NULL) is fair game to delete. A grace window so a
/// temporarily-late root span (slow network, retry) can still patch
/// the row before it disappears.
const ORPHAN_TRACE_PRUNE_DELAY_HOURS: i64 = 1;

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

/// Read `SENTORI_TRACE_RETENTION_DAYS`; default 14, clamped to ≥1.
pub fn trace_retention_days() -> i64 {
    std::env::var("SENTORI_TRACE_RETENTION_DAYS")
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .filter(|&n| n >= 1)
        .unwrap_or(DEFAULT_TRACE_RETENTION_DAYS)
}

pub async fn run_once(pool: &PgPool) -> Result<RetentionStats, anyhow::Error> {
    let now = OffsetDateTime::now_utc();

    let mut created = 0u32;
    for table in PARTITIONED_TABLES {
        created += ensure_future_partitions(pool, now, table, FUTURE_MONTHS).await?;
    }

    // events: longest plan retention, floor 30 days.
    let max_days: i64 = sqlx::query_scalar::<_, i32>(
        "SELECT COALESCE(MAX(retention_days), 30)::int4 FROM org_quotas",
    )
    .fetch_one(pool)
    .await? as i64;
    let events_cutoff = now - Duration::days(max_days.max(EVENTS_RETENTION_FLOOR_DAYS));

    // spans + traces: SENTORI_TRACE_RETENTION_DAYS (default 14).
    let trace_days = trace_retention_days();
    let trace_cutoff = now - Duration::days(trace_days);

    let mut dropped = 0u32;
    dropped += drop_expired_partitions(pool, "events", events_cutoff).await?;
    dropped += drop_expired_partitions(pool, "spans", trace_cutoff).await?;

    let traces_deleted = prune_traces(pool, trace_cutoff).await?;
    let orphan_traces_deleted = prune_orphan_traces(pool, now).await?;

    if created > 0 || dropped > 0 || traces_deleted > 0 || orphan_traces_deleted > 0 {
        tracing::info!(
            created,
            dropped,
            traces_deleted,
            orphan_traces_deleted,
            events_retention_days = max_days.max(EVENTS_RETENTION_FLOOR_DAYS),
            trace_retention_days = trace_days,
            "retention pass complete"
        );
    }
    Ok(RetentionStats { created, dropped, traces_deleted, orphan_traces_deleted })
}

#[derive(Debug)]
pub struct RetentionStats {
    pub created: u32,
    pub dropped: u32,
    pub traces_deleted: u64,
    pub orphan_traces_deleted: u64,
}

/// Delete `traces` rows with `last_seen` older than `cutoff`. (traces
/// isn't partitioned — see migration 0029 — so it's a plain delete via
/// `traces_last_seen_idx`.) Returns the row count.
pub async fn prune_traces(pool: &PgPool, cutoff: OffsetDateTime) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query("DELETE FROM traces WHERE last_seen < $1")
        .bind(cutoff)
        .execute(pool)
        .await?
        .rows_affected())
}

/// Delete `traces` rows where the root span never arrived — i.e.
/// `root_op IS NULL`. These are "orphan" traces: child spans landed
/// and built up the row's span_count + status, but no INSERT was
/// ever issued for the root span. The classic shape is a dev-mode
/// fast-refresh race in the SDK's useTraceNavigation hook (Insight
/// reported 2026-05-13): React drops the nav span's useRef during
/// hot-reload before its cleanup runs `finish()`, leaving the child
/// fetch spans pointing at a span_id that will never exist.
///
/// Waits `ORPHAN_TRACE_PRUNE_DELAY_HOURS` past the last child before
/// deleting, so a temporarily-late root span (slow network, retry)
/// can still patch the row instead of being deleted as orphan.
///
/// Child spans in the `spans` table aren't touched here — they fall
/// off naturally with `spans` partition drops at
/// `SENTORI_TRACE_RETENTION_DAYS` (14 by default).
pub async fn prune_orphan_traces(
    pool: &PgPool,
    now: OffsetDateTime,
) -> Result<u64, sqlx::Error> {
    let cutoff = now - Duration::hours(ORPHAN_TRACE_PRUNE_DELAY_HOURS);
    Ok(sqlx::query("DELETE FROM traces WHERE root_op IS NULL AND last_seen < $1")
        .bind(cutoff)
        .execute(pool)
        .await?
        .rows_affected())
}

async fn child_partitions(pool: &PgPool, parent: &str) -> Result<HashSet<String>, sqlx::Error> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT c.relname FROM pg_inherits i \
         JOIN pg_class p ON i.inhparent = p.oid \
         JOIN pg_class c ON i.inhrelid = c.oid \
         WHERE p.relname = $1",
    )
    .bind(parent)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect())
}

async fn ensure_future_partitions(
    pool: &PgPool,
    now: OffsetDateTime,
    table: &str,
    months_ahead: u32,
) -> Result<u32, sqlx::Error> {
    // CREATE TABLE's rows_affected is always 0, so snapshot what exists.
    let existing = child_partitions(pool, table).await?;

    let mut created = 0u32;
    for offset in 0..months_ahead {
        let (y, m) = add_months(now.year(), u8::from(now.month()), offset);
        let (ny, nm) = next_month(y, m);
        let name = format!("{table}_{y:04}_{m:02}");
        if existing.contains(&name) {
            continue;
        }
        let from = format!("{y:04}-{m:02}-01");
        let to = format!("{ny:04}-{nm:02}-01");
        // `table` is from a hardcoded list; y/m/ny/nm are integers we
        // generated. Injection-safe by construction.
        let sql = format!(
            "CREATE TABLE IF NOT EXISTS {name} PARTITION OF {table} \
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
    table: &str,
    cutoff: OffsetDateTime,
) -> Result<u32, sqlx::Error> {
    let re = format!("^{table}_[0-9]{{4}}_[0-9]{{2}}$");
    let partitions: Vec<String> = sqlx::query_scalar(
        "SELECT c.relname FROM pg_inherits i \
         JOIN pg_class p ON i.inhparent = p.oid \
         JOIN pg_class c ON i.inhrelid = c.oid \
         WHERE p.relname = $1 AND c.relname ~ $2",
    )
    .bind(table)
    .bind(&re)
    .fetch_all(pool)
    .await?;

    let mut dropped = 0u32;
    for name in partitions {
        let Some((y, m)) = parse_partition_name(&name, table) else {
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
        // name matched the regex + parse; no injection vector.
        let sql = format!("DROP TABLE IF EXISTS {name}");
        sqlx::query(&sql).execute(pool).await?;
        dropped += 1;
        tracing::info!(partition = %name, "dropped expired partition");
    }
    Ok(dropped)
}

fn parse_partition_name(name: &str, table: &str) -> Option<(i32, u8)> {
    let rest = name.strip_prefix(table)?.strip_prefix('_')?;
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
        assert_eq!(parse_partition_name("events_2026_05", "events"), Some((2026, 5)));
        assert_eq!(parse_partition_name("spans_2030_12", "spans"), Some((2030, 12)));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_partition_name("events_default", "events"), None);
        assert_eq!(parse_partition_name("events_2026_13", "events"), None);
        assert_eq!(parse_partition_name("events_2026", "events"), None);
        assert_eq!(parse_partition_name("events_2026_05_extra", "events"), None);
        assert_eq!(parse_partition_name("oops_2026_05", "events"), None);
        // wrong table prefix
        assert_eq!(parse_partition_name("spans_2026_05", "events"), None);
        assert_eq!(parse_partition_name("spans_default", "spans"), None);
    }

    #[test]
    fn add_months_handles_year_rollover() {
        assert_eq!(add_months(2026, 5, 0), (2026, 5));
        assert_eq!(add_months(2026, 5, 7), (2026, 12));
        assert_eq!(add_months(2026, 5, 8), (2027, 1));
        assert_eq!(add_months(2026, 12, 13), (2028, 1));
    }
}
