//! Ops / monitoring tables — endpoint_probes, endpoint_alerts,
//! pii_findings, digest_subscriptions, webhook_deliveries.

use anyhow::Result;
use serde_json::Value;
use sqlx::{PgPool, Row};
use tracing::info;

use crate::report::Report;

pub async fn migrate(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let mut total = 0u64;
    total += endpoint_probes(src, dst, dry_run, report).await?;
    total += endpoint_alerts(src, dst, dry_run, report).await?;
    total += pii_findings(src, dst, dry_run, report).await?;
    total += digest_subscriptions(src, dst, dry_run, report).await?;
    total += webhook_deliveries(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn endpoint_probes(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT ep.id, p.org_id AS workspace_id, ep.project_id, ep.endpoint_url, ep.method, \
                ep.expected_status, ep.body_template, ep.headers, ep.timeout_ms, ep.interval_sec, \
                ep.enabled, ep.created_at \
         FROM endpoint_probes ep JOIN projects p ON p.id = ep.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("endpoint_probes", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO endpoint_probes (id, workspace_id, project_id, endpoint_url, method, \
                expected_status, body_template, headers, timeout_ms, interval_sec, enabled, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<String, _>("endpoint_url"))
        .bind(r.try_get::<String, _>("method").unwrap_or_else(|_| "GET".into()))
        .bind(r.try_get::<i32, _>("expected_status").unwrap_or(200))
        .bind(r.try_get::<Option<String>, _>("body_template").ok().flatten())
        .bind(r.try_get::<Value, _>("headers").unwrap_or(Value::Null))
        .bind(r.try_get::<i32, _>("timeout_ms").unwrap_or(5000))
        .bind(r.try_get::<i32, _>("interval_sec").unwrap_or(60))
        .bind(r.try_get::<bool, _>("enabled").unwrap_or(true))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("endpoint_probes", written);
    report.note_skipped("endpoint_probes", skipped);
    info!(read = rows.len(), written, skipped, "endpoint_probes");
    Ok(written)
}

async fn endpoint_alerts(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT ea.id, p.org_id AS workspace_id, ea.project_id, ea.probe_id, ea.status, \
                ea.error_message, ea.duration_ms, ea.observed_at \
         FROM endpoint_alerts ea JOIN projects p ON p.id = ea.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("endpoint_alerts", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO endpoint_alerts (id, workspace_id, project_id, probe_id, status, \
                error_message, duration_ms, observed_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<uuid::Uuid, _>("probe_id"))
        .bind(r.get::<String, _>("status"))
        .bind(r.try_get::<Option<String>, _>("error_message").ok().flatten())
        .bind(r.try_get::<Option<i32>, _>("duration_ms").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("observed_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("endpoint_alerts", written);
    report.note_skipped("endpoint_alerts", skipped);
    info!(read = rows.len(), written, skipped, "endpoint_alerts");
    Ok(written)
}

async fn pii_findings(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT pf.id, p.org_id AS workspace_id, pf.project_id, pf.event_id, pf.field_path, \
                pf.kind, pf.severity, pf.created_at \
         FROM pii_findings pf JOIN projects p ON p.id = pf.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("pii_findings", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO pii_findings (id, workspace_id, project_id, event_id, field_path, \
                kind, severity, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("event_id").ok().flatten())
        .bind(r.get::<String, _>("field_path"))
        .bind(r.get::<String, _>("kind"))
        .bind(r.try_get::<String, _>("severity").unwrap_or_else(|_| "low".into()))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("pii_findings", written);
    report.note_skipped("pii_findings", skipped);
    info!(read = rows.len(), written, skipped, "pii_findings");
    Ok(written)
}

async fn digest_subscriptions(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT ds.id, p.org_id AS workspace_id, ds.project_id, ds.user_id, ds.cadence, \
                ds.timezone, ds.next_send_at, ds.last_sent_at, ds.enabled \
         FROM digest_subscriptions ds JOIN projects p ON p.id = ds.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("digest_subscriptions", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO digest_subscriptions (id, workspace_id, project_id, user_id, cadence, \
                timezone, next_send_at, last_sent_at, enabled) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.get::<String, _>("cadence"))
        .bind(r.try_get::<Option<String>, _>("timezone").ok().flatten())
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("next_send_at").ok().flatten())
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("last_sent_at").ok().flatten())
        .bind(r.try_get::<bool, _>("enabled").unwrap_or(true))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("digest_subscriptions", written);
    report.note_skipped("digest_subscriptions", skipped);
    info!(read = rows.len(), written, skipped, "digest_subscriptions");
    Ok(written)
}

async fn webhook_deliveries(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT wd.id, p.org_id AS workspace_id, wd.project_id, wd.integration_id, wd.event_kind, \
                wd.payload, wd.status, wd.response_status, wd.response_body, wd.attempt, \
                wd.next_retry_at, wd.created_at, wd.completed_at \
         FROM webhook_deliveries wd JOIN projects p ON p.id = wd.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("webhook_deliveries", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO webhook_deliveries (id, workspace_id, project_id, integration_id, event_kind, \
                payload, status, response_status, response_body, attempt, next_retry_at, \
                created_at, completed_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<uuid::Uuid, _>("integration_id"))
        .bind(r.get::<String, _>("event_kind"))
        .bind(r.try_get::<Value, _>("payload").unwrap_or(Value::Null))
        .bind(r.get::<String, _>("status"))
        .bind(r.try_get::<Option<i32>, _>("response_status").ok().flatten())
        .bind(r.try_get::<Option<String>, _>("response_body").ok().flatten())
        .bind(r.try_get::<i32, _>("attempt").unwrap_or(1))
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("next_retry_at").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("completed_at").ok().flatten())
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("webhook_deliveries", written);
    report.note_skipped("webhook_deliveries", skipped);
    info!(read = rows.len(), written, skipped, "webhook_deliveries");
    Ok(written)
}
