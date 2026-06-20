// v2.1 W4 — endpoint probe cron + assertion engine + auto-issue
// lifecycle.
//
// One global cron (60 s tick) scans `endpoint_check` for checks
// whose interval has elapsed since the last probe, fans out via
// tokio::spawn with concurrency cap 32, posts a probe row, and
// runs the consecutive-2 issue lifecycle.
//
// Schema in migrations 0070 / 0071 / 0072. Full rationale in
// docs/design/v2-endpoint-health.md.

use std::time::Duration;

use anyhow::Result;
use reqwest::Client as ReqwestClient;
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::sync::Semaphore;
use uuid::Uuid;

const TICK_SECS: u64 = 60;
const CONCURRENCY_CAP: usize = 32;
const PROBE_TIMEOUT_SECS: u64 = 30;
// Cap how much of the response body we'll read before bailing —
// substring assertions never need more than a few KB and we don't
// want a megabyte-sized happy-path response to bloat the prober.
const MAX_BODY_BYTES: usize = 64 * 1024;

/// Configuration for one probe attempt. Built from a row in
/// `endpoint_check` plus optional per-probe overrides.
#[derive(Debug, Clone)]
pub struct ProbeConfig {
    pub check_id: Uuid,
    pub project_id: Uuid,
    pub target_url: String,
    pub method: String,
    pub status_codes: Vec<i32>,
    pub body_substring: Option<String>,
    pub max_latency_ms: Option<i32>,
}

/// Outcome of running one probe attempt. `Ok` when every assertion
/// held; `Fail` carries the static error_kind discriminator.
#[derive(Debug, PartialEq, Eq)]
pub enum ProbeOutcome {
    Ok,
    Fail(&'static str),
}

impl ProbeOutcome {
    fn as_db_kind(&self) -> Option<&'static str> {
        match self {
            ProbeOutcome::Ok => None,
            ProbeOutcome::Fail(k) => Some(*k),
        }
    }
    fn is_ok(&self) -> bool {
        matches!(self, ProbeOutcome::Ok)
    }
}

/// One probe row as it lands in `endpoint_probe`.
#[derive(Debug)]
pub struct ProbeRow {
    pub status_code: i32,
    pub latency_ms: i32,
    pub outcome: ProbeOutcome,
}

/// Pure assertion engine. Lifted out of the HTTP path so the unit
/// tests below can replay arbitrary (status, body, latency)
/// combinations without spinning a real client.
pub fn evaluate(
    cfg: &ProbeConfig,
    status_code: i32,
    body: &str,
    latency_ms: i32,
) -> ProbeOutcome {
    if !cfg.status_codes.contains(&status_code) {
        return ProbeOutcome::Fail("status");
    }
    if let Some(needle) = &cfg.body_substring {
        if !body.contains(needle.as_str()) {
            return ProbeOutcome::Fail("body");
        }
    }
    if let Some(max) = cfg.max_latency_ms {
        if latency_ms > max {
            return ProbeOutcome::Fail("latency");
        }
    }
    ProbeOutcome::Ok
}

/// Classify a reqwest::Error into the (small) error_kind taxonomy
/// the dashboard understands. Inspects the error chain because
/// reqwest folds the cause into source().
fn classify_error(err: &reqwest::Error) -> &'static str {
    if err.is_timeout() {
        return "timeout";
    }
    if err.is_connect() {
        // Could be DNS, TCP, or TLS. Walk the source chain looking
        // for the hint string. reqwest doesn't surface a typed
        // discriminator so we string-match the lower-cased message.
        let mut src: &dyn std::error::Error = err;
        loop {
            let lower = src.to_string().to_lowercase();
            if lower.contains("dns") || lower.contains("name resolution") {
                return "dns";
            }
            if lower.contains("tls") || lower.contains("ssl") || lower.contains("certificate") {
                return "tls";
            }
            match src.source() {
                Some(s) => src = s,
                None => break,
            }
        }
        return "tcp";
    }
    if err.is_request() {
        return "tcp";
    }
    // Last-resort bucket.
    "tcp"
}

/// Run one probe against `cfg.target_url` and return a ProbeRow.
/// Never panics — every failure path produces a row with a
/// classified error_kind.
pub async fn run_probe(client: &ReqwestClient, cfg: &ProbeConfig) -> ProbeRow {
    let started = std::time::Instant::now();
    let req = match cfg.method.as_str() {
        "POST" => client.post(&cfg.target_url),
        "HEAD" => client.head(&cfg.target_url),
        _ => client.get(&cfg.target_url),
    };
    let result = req.send().await;
    let resp = match result {
        Ok(r) => r,
        Err(e) => {
            let latency_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32;
            return ProbeRow {
                status_code: 0,
                latency_ms,
                outcome: ProbeOutcome::Fail(classify_error(&e)),
            };
        }
    };
    let status_code = resp.status().as_u16() as i32;
    let body_result = resp.text().await;
    let latency_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32;
    let body = match body_result {
        Ok(b) => {
            // Cap before assertion so substring scan stays bounded.
            if b.len() > MAX_BODY_BYTES {
                b[..MAX_BODY_BYTES].to_string()
            } else {
                b
            }
        }
        Err(_) => {
            return ProbeRow {
                status_code,
                latency_ms,
                outcome: ProbeOutcome::Fail("timeout"),
            };
        }
    };
    let outcome = evaluate(cfg, status_code, &body, latency_ms);
    ProbeRow {
        status_code,
        latency_ms,
        outcome,
    }
}

/// Spawn the 60 s endpoint probe cron + hourly rollup cron +
/// hourly partition lifecycle cron. Matches the existing
/// metrics_rollup / metrics_partition split — one tokio task per
/// concern, owned by main.rs startup sequencing.
pub fn spawn_cron(pool: PgPool) {
    spawn_probe_cron(pool.clone());
    spawn_rollup_cron(pool.clone());
    spawn_partition_cron(pool);
}

fn spawn_probe_cron(pool: PgPool) {
    tokio::spawn(async move {
        // Warmup so we don't race the partition cron on cold-start.
        tokio::time::sleep(Duration::from_secs(20)).await;
        let client = match ReqwestClient::builder()
            .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
            .user_agent("sentori-endpoint-probe/2.1")
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(error = %e, "endpoint probe client init failed");
                return;
            }
        };
        let sem = std::sync::Arc::new(Semaphore::new(CONCURRENCY_CAP));
        loop {
            if let Err(e) = sweep_once(&pool, &client, &sem).await {
                tracing::warn!(error = %e, "endpoint probe sweep failed");
            }
            tokio::time::sleep(Duration::from_secs(TICK_SECS)).await;
        }
    });
}

async fn sweep_once(
    pool: &PgPool,
    client: &ReqwestClient,
    sem: &std::sync::Arc<Semaphore>,
) -> Result<()> {
    // Scan-due query: every active check whose latest probe is
    // older than `interval_sec`, OR which has never been probed.
    // The LATERAL join folds the per-check "last probe ts" lookup
    // into a single round-trip.
    let rows: Vec<(
        Uuid,
        Uuid,
        String,
        String,
        Vec<i32>,
        Option<String>,
        Option<i32>,
    )> = sqlx::query_as(
        "SELECT c.id, c.project_id, c.target_url, c.method, \
                c.assertion_status_codes, c.assertion_body_substring, \
                c.assertion_max_latency_ms \
         FROM endpoint_check c \
         LEFT JOIN LATERAL ( \
           SELECT ts FROM endpoint_probe \
            WHERE check_id = c.id \
            ORDER BY ts DESC LIMIT 1 \
         ) lp ON TRUE \
         WHERE NOT c.paused \
           AND (lp.ts IS NULL OR lp.ts + (c.interval_sec || ' seconds')::interval < now()) \
         LIMIT 500",
    )
    .fetch_all(pool)
    .await?;

    for (
        check_id,
        project_id,
        target_url,
        method,
        status_codes,
        body_substring,
        max_latency_ms,
    ) in rows
    {
        let cfg = ProbeConfig {
            check_id,
            project_id,
            target_url,
            method,
            status_codes,
            body_substring,
            max_latency_ms,
        };
        let pool = pool.clone();
        let client = client.clone();
        let sem = sem.clone();
        tokio::spawn(async move {
            let _permit = match sem.acquire_owned().await {
                Ok(p) => p,
                Err(_) => return,
            };
            let row = run_probe(&client, &cfg).await;
            if let Err(e) = persist_and_update_issue(&pool, &cfg, &row).await {
                tracing::warn!(error = %e, %cfg.check_id, "endpoint probe persist failed");
            }
        });
    }
    Ok(())
}

async fn persist_and_update_issue(
    pool: &PgPool,
    cfg: &ProbeConfig,
    row: &ProbeRow,
) -> Result<()> {
    // INSERT probe row first. The partition is auto-created by the
    // partition cron, but in the worst case a missed-tick race
    // could mean today's partition doesn't exist yet — log + drop
    // gracefully (the consecutive-2 lifecycle catches up on the
    // next probe).
    let r = sqlx::query(
        "INSERT INTO endpoint_probe (ts, check_id, status_code, latency_ms, ok, error_kind) \
         VALUES (now(), $1, $2, $3, $4, $5)",
    )
    .bind(cfg.check_id)
    .bind(row.status_code)
    .bind(row.latency_ms)
    .bind(row.outcome.is_ok())
    .bind(row.outcome.as_db_kind())
    .execute(pool)
    .await;
    if let Err(e) = r {
        tracing::warn!(error = %e, "endpoint_probe insert failed");
        return Ok(());
    }

    // Consecutive-2 issue lifecycle. Read the last 2 probes (the
    // INSERT above is one of them).
    let last2: Vec<(bool,)> = sqlx::query_as(
        "SELECT ok FROM endpoint_probe \
         WHERE check_id = $1 \
         ORDER BY ts DESC LIMIT 2",
    )
    .bind(cfg.check_id)
    .fetch_all(pool)
    .await?;

    // Not enough history — nothing to decide.
    if last2.len() < 2 {
        return Ok(());
    }
    let all_fail = last2.iter().all(|(ok,)| !ok);
    let all_pass = last2.iter().all(|(ok,)| *ok);

    if all_fail {
        // Issue is created in `issues` table — its full schema is
        // outside this module. For v2.1 W4 part 2 we INSERT a
        // minimal row and let the existing notifier route it.
        // The fingerprint is stable per (project, target_url) so
        // repeated fail bursts coalesce into one open issue.
        let _ = sqlx::query(
            "INSERT INTO issues (id, project_id, fingerprint, error_type, message_sample, \
                                 status, first_seen, last_seen, event_count) \
             VALUES (gen_random_uuid(), $1, $2, 'endpoint_down', $3, 'open', now(), now(), 1) \
             ON CONFLICT (project_id, fingerprint) DO UPDATE SET \
                last_seen = now(), \
                event_count = issues.event_count + 1, \
                status = CASE WHEN issues.status = 'resolved' THEN 'open' ELSE issues.status END",
        )
        .bind(cfg.project_id)
        .bind(format!("endpoint_down:{}", cfg.target_url))
        .bind(format!(
            "{} {} → {}{}",
            cfg.method,
            cfg.target_url,
            row.status_code,
            row.outcome
                .as_db_kind()
                .map(|k| format!(" ({k})"))
                .unwrap_or_default()
        ))
        .execute(pool)
        .await;
    } else if all_pass {
        // Auto-resolve any open endpoint_down issue for this URL.
        // No-op when no matching issue exists (e.g. check has only
        // ever been ok).
        let _ = sqlx::query(
            "UPDATE issues \
             SET status = 'resolved', resolved_at = now() \
             WHERE project_id = $1 \
               AND fingerprint = $2 \
               AND status = 'open'",
        )
        .bind(cfg.project_id)
        .bind(format!("endpoint_down:{}", cfg.target_url))
        .execute(pool)
        .await;
    }
    Ok(())
}

// ───────────────────────────── rollup cron ──────────────────────

fn spawn_rollup_cron(pool: PgPool) {
    tokio::spawn(async move {
        loop {
            let now = OffsetDateTime::now_utc();
            let secs_to_next = 60 - now.second() as i64;
            tokio::time::sleep(Duration::from_secs((secs_to_next + 1) as u64)).await;
            let now = OffsetDateTime::now_utc();
            // Minute 04 (offset from metrics_rollup's minute 03 so
            // the two crons don't fight for the buffer pool).
            if now.minute() == 4 {
                if let Err(e) = rollup_previous_hour(&pool).await {
                    tracing::warn!(error = %e, "endpoint probe rollup failed");
                }
            }
        }
    });
}

async fn rollup_previous_hour(pool: &PgPool) -> Result<()> {
    let n = sqlx::query(
        "INSERT INTO endpoint_probe_1h \
            (bucket_ts, check_id, probe_count, ok_count, uptime_pct, p50_latency_ms, p95_latency_ms) \
         SELECT \
            date_trunc('hour', ts) AS bucket_ts, \
            check_id, \
            COUNT(*)::integer AS probe_count, \
            COUNT(*) FILTER (WHERE ok)::integer AS ok_count, \
            (COUNT(*) FILTER (WHERE ok))::double precision / GREATEST(COUNT(*), 1) * 100.0 AS uptime_pct, \
            COALESCE(PERCENTILE_DISC(0.5)  WITHIN GROUP (ORDER BY latency_ms), 0)::integer AS p50, \
            COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::integer AS p95 \
         FROM endpoint_probe \
         WHERE ts >= date_trunc('hour', now() - interval '1 hour') \
           AND ts <  date_trunc('hour', now()) \
         GROUP BY 1, 2 \
         ON CONFLICT (check_id, bucket_ts) DO UPDATE SET \
            probe_count    = EXCLUDED.probe_count, \
            ok_count       = EXCLUDED.ok_count, \
            uptime_pct     = EXCLUDED.uptime_pct, \
            p50_latency_ms = EXCLUDED.p50_latency_ms, \
            p95_latency_ms = EXCLUDED.p95_latency_ms",
    )
    .execute(pool)
    .await?
    .rows_affected();
    tracing::info!(rolled = n, "endpoint probe 1h rollup tick");
    Ok(())
}

// ─────────────────────── partition cron ─────────────────────────
//
// Mirror of metrics_partition: hourly ensure-window + daily DROP
// of partitions past 30 d retention. The functions live here
// rather than in metrics_partition.rs because the partition naming
// + base table differ.

const PARTITION_TICK_SECS: u64 = 60 * 60; // hourly
const RETENTION_DAYS: i64 = 30;

const DAY_FMT: &[time::format_description::FormatItem<'_>] =
    time::macros::format_description!("[year]_[month]_[day]");
const DAY_BOUND_FMT: &[time::format_description::FormatItem<'_>] =
    time::macros::format_description!("[year]-[month]-[day] 00:00:00+00");

fn spawn_partition_cron(pool: PgPool) {
    tokio::spawn(async move {
        if let Err(e) = ensure_partition_window(&pool).await {
            tracing::warn!(error = %e, "endpoint_probe partition bootstrap failed");
        }
        loop {
            tokio::time::sleep(Duration::from_secs(PARTITION_TICK_SECS)).await;
            if let Err(e) = ensure_partition_window(&pool).await {
                tracing::warn!(error = %e, "endpoint_probe partition ensure failed");
            }
            let now = OffsetDateTime::now_utc();
            if now.hour() == 3 {
                if let Err(e) = drop_expired_partitions(&pool).await {
                    tracing::warn!(error = %e, "endpoint_probe partition expiry failed");
                }
            }
        }
    });
}

async fn ensure_partition_window(pool: &PgPool) -> Result<()> {
    let today = OffsetDateTime::now_utc().date();
    for offset in 0..=2 {
        let d = today + time::Duration::days(offset);
        let next = d + time::Duration::days(1);
        let part_name = format!("endpoint_probe_{}", d.format(DAY_FMT)?);
        let from_bound = d.format(DAY_BOUND_FMT)?;
        let to_bound = next.format(DAY_BOUND_FMT)?;
        let sql = format!(
            "CREATE TABLE IF NOT EXISTS {part_name} \
             PARTITION OF endpoint_probe \
             FOR VALUES FROM ('{from_bound}') TO ('{to_bound}')",
        );
        sqlx::query(&sql).execute(pool).await?;
    }
    Ok(())
}

async fn drop_expired_partitions(pool: &PgPool) -> Result<()> {
    let cutoff = OffsetDateTime::now_utc().date() - time::Duration::days(RETENTION_DAYS);
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT c.relname \
         FROM pg_inherits i \
         JOIN pg_class c ON c.oid = i.inhrelid \
         JOIN pg_class p ON p.oid = i.inhparent \
         WHERE p.relname = 'endpoint_probe'",
    )
    .fetch_all(pool)
    .await?;
    for (relname,) in rows {
        if let Some(suffix) = relname.strip_prefix("endpoint_probe_") {
            if let Ok(d) = time::Date::parse(suffix, DAY_FMT) {
                if d < cutoff {
                    let sql = format!("DROP TABLE IF EXISTS {relname}");
                    if let Err(e) = sqlx::query(&sql).execute(pool).await {
                        tracing::warn!(error = %e, partition = %relname, "drop endpoint_probe partition failed");
                    } else {
                        tracing::info!(partition = %relname, "dropped expired endpoint_probe partition");
                    }
                }
            }
        }
    }
    Ok(())
}

// ────────────────────────────── tests ───────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(status_codes: Vec<i32>, body: Option<&str>, max_lat: Option<i32>) -> ProbeConfig {
        ProbeConfig {
            check_id: Uuid::nil(),
            project_id: Uuid::nil(),
            target_url: "http://localhost".into(),
            method: "GET".into(),
            status_codes,
            body_substring: body.map(|s| s.to_string()),
            max_latency_ms: max_lat,
        }
    }

    #[test]
    fn evaluate_passes_when_every_assertion_holds() {
        let c = cfg(vec![200], Some("\"ok\""), Some(1000));
        assert_eq!(
            evaluate(&c, 200, "{\"status\":\"ok\"}", 250),
            ProbeOutcome::Ok
        );
    }

    #[test]
    fn evaluate_fails_on_status_first() {
        // Body would also fail, but status is checked first — the
        // ordering matters because the error_kind drives the
        // dashboard label.
        let c = cfg(vec![200], Some("\"ok\""), Some(1000));
        assert_eq!(evaluate(&c, 503, "anything", 250), ProbeOutcome::Fail("status"));
    }

    #[test]
    fn evaluate_fails_on_body_missing() {
        let c = cfg(vec![200], Some("\"ok\""), None);
        assert_eq!(
            evaluate(&c, 200, "{\"status\":\"degraded\"}", 250),
            ProbeOutcome::Fail("body")
        );
    }

    #[test]
    fn evaluate_fails_on_latency_exceeded() {
        let c = cfg(vec![200], None, Some(500));
        assert_eq!(evaluate(&c, 200, "", 1200), ProbeOutcome::Fail("latency"));
    }

    #[test]
    fn evaluate_skips_unconfigured_assertions() {
        // No body or latency assertion → only status matters.
        let c = cfg(vec![200, 201], None, None);
        assert_eq!(evaluate(&c, 201, "", 10_000), ProbeOutcome::Ok);
    }

    #[test]
    fn evaluate_multiple_status_codes() {
        let c = cfg(vec![200, 204, 304], None, None);
        assert_eq!(evaluate(&c, 304, "", 5), ProbeOutcome::Ok);
        assert_eq!(evaluate(&c, 500, "", 5), ProbeOutcome::Fail("status"));
    }
}
