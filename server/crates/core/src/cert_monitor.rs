// v0.8.4 — Certificate Transparency monitoring via crt.sh poll.
//
// Background tokio task. On a 10-minute tick:
//   1. SELECT (project_id, domain) FROM cert_watch_domains
//   2. For each domain, GET https://crt.sh/?q=%domain&output=json
//   3. UPSERT into cert_observations; (project_id, cert_id) UNIQUE
//      drops re-poll dupes, so anything that hits `INSERT ... ON
//      CONFLICT DO NOTHING` returning a row was actually new.
//   4. For each NEW row, fan out a NotifyEvent::CertObserved.
//
// crt.sh occasionally returns 502 / takes 30+ seconds on a popular
// domain; we set a 20 s timeout and silently skip on error. Next
// tick retries.
//
// Resource usage: O(watchlist size) HTTP calls per tick. With the
// per-call timeout and 10-minute spacing we'd need >5k watched
// domains to overlap into the next tick; we'll revisit pacing then.

use std::time::Duration;

use anyhow::{Context, Result};
use serde::Deserialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::notifier::NotifyEvent;

const POLL_INTERVAL_SECS: u64 = 600;
const HTTP_TIMEOUT_SECS: u64 = 20;

#[derive(Debug, Deserialize)]
struct CrtShCert {
    id: i64,
    common_name: Option<String>,
    name_value: Option<String>,
    issuer_name: String,
    /// crt.sh returns naive datetimes without a zone; they're UTC.
    /// Format: "2024-01-01T00:00:00".
    not_before: String,
    not_after: String,
}

/// Spawn the background poll loop. Idempotent at the call site —
/// only call once at server startup. Drops the JoinHandle since the
/// task lives for the lifetime of the process; errors inside the
/// loop are logged + swallowed (we want the task to survive a
/// transient db / network blip).
pub fn spawn(pool: PgPool, notifier_tx: tokio::sync::mpsc::Sender<NotifyEvent>) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .user_agent("sentori-cert-monitor/0.8.4 (+https://sentori.golia.jp)")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "cert-monitor: HTTP client build failed; cert monitor disabled for this run");
            return;
        }
    };
    tokio::spawn(async move {
        // First tick after a 30 s warm-up — gives the rest of the
        // server time to settle before we hammer crt.sh.
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            if let Err(e) = poll_once(&pool, &client, &notifier_tx).await {
                tracing::warn!(error = %e, "cert-monitor: poll tick failed");
            }
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
        }
    });
}

async fn poll_once(
    pool: &PgPool,
    client: &reqwest::Client,
    notifier_tx: &tokio::sync::mpsc::Sender<NotifyEvent>,
) -> Result<()> {
    let domains: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT project_id, domain FROM cert_watch_domains",
    )
    .fetch_all(pool)
    .await
    .context("fetch watch domains")?;

    for (project_id, domain) in domains {
        if let Err(e) = poll_domain(pool, client, notifier_tx, project_id, &domain).await {
            tracing::warn!(error = %e, %project_id, %domain, "cert-monitor: domain poll failed");
        }
    }
    Ok(())
}

async fn poll_domain(
    pool: &PgPool,
    client: &reqwest::Client,
    notifier_tx: &tokio::sync::mpsc::Sender<NotifyEvent>,
    project_id: Uuid,
    domain: &str,
) -> Result<()> {
    // `%` prefix tells crt.sh to wildcard-match subdomains.
    let url = format!(
        "https://crt.sh/?q=%25.{}&output=json",
        urlencoding::encode(domain),
    );
    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("crt.sh status {} for {}", resp.status(), domain);
    }
    let certs: Vec<CrtShCert> = resp.json().await?;
    for c in certs {
        let not_before = parse_crt_sh_ts(&c.not_before)?;
        let not_after = parse_crt_sh_ts(&c.not_after)?;
        let id = Uuid::now_v7();
        // INSERT ... ON CONFLICT DO NOTHING — UNIQUE (project_id,
        // cert_id) drops re-polls of the same cert. `RETURNING id`
        // is empty on dupe → we only notify for truly new rows.
        let inserted: Option<(Uuid,)> = sqlx::query_as(
            "INSERT INTO cert_observations \
             (id, project_id, domain, cert_id, common_name, name_value, issuer_name, not_before, not_after) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
             ON CONFLICT (project_id, cert_id) DO NOTHING \
             RETURNING id",
        )
        .bind(id)
        .bind(project_id)
        .bind(domain)
        .bind(c.id)
        .bind(c.common_name.as_deref())
        .bind(c.name_value.as_deref().map(|s| truncate(s, 8000)))
        .bind(&c.issuer_name)
        .bind(not_before)
        .bind(not_after)
        .fetch_optional(pool)
        .await?;
        if inserted.is_some() {
            let _ = notifier_tx
                .send(NotifyEvent::CertObserved {
                    project_id,
                    domain: domain.to_string(),
                    cert_id: c.id,
                    common_name: c.common_name,
                    issuer_name: c.issuer_name,
                    not_before,
                    not_after,
                })
                .await;
        }
    }
    Ok(())
}

/// crt.sh emits zoneless ISO 8601: `2024-01-01T00:00:00`. We treat as UTC.
fn parse_crt_sh_ts(s: &str) -> Result<OffsetDateTime> {
    // Pad to RFC 3339 by appending `Z`. crt.sh sometimes uses `.000`
    // milliseconds — passes through fine.
    let with_z = if s.ends_with('Z') {
        s.to_string()
    } else {
        format!("{s}Z")
    };
    Ok(OffsetDateTime::parse(
        &with_z,
        &time::format_description::well_known::Rfc3339,
    )?)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut t = s[..max].to_string();
        // Don't slice in the middle of a UTF-8 codepoint.
        while !t.is_char_boundary(t.len()) && !t.is_empty() {
            t.pop();
        }
        t
    }
}
