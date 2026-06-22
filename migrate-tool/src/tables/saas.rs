//! SaaS-only tables — saasadmin_users, saas_provisioning_log,
//! and anything else legacy saas-control owned.
//!
//! Skipped silently when source schema lacks them (self-hosted
//! cutover never has these rows).

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
    total += saasadmin_users(src, dst, dry_run, report).await?;
    total += saas_provisioning_log(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn saasadmin_users(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let Ok(rows) = sqlx::query(
        "SELECT id, email, password_hash, role, created_at FROM saasadmin_users",
    )
    .fetch_all(src)
    .await
    else {
        report.note_read("saasadmin_users", 0);
        return Ok(0);
    };
    report.note_read("saasadmin_users", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO saasadmin_users (id, email, password_hash, role, created_at) \
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<String, _>("email"))
        .bind(r.get::<String, _>("password_hash"))
        .bind(r.try_get::<String, _>("role").unwrap_or_else(|_| "saasadmin".into()))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("saasadmin_users", written);
    report.note_skipped("saasadmin_users", skipped);
    info!(read = rows.len(), written, skipped, "saasadmin_users");
    Ok(written)
}

async fn saas_provisioning_log(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let Ok(rows) = sqlx::query(
        "SELECT id, workspace_id, step, status, details, created_at FROM saas_provisioning_log \
         ORDER BY created_at DESC LIMIT 10000",
    )
    .fetch_all(src)
    .await
    else {
        report.note_read("saas_provisioning_log", 0);
        return Ok(0);
    };
    report.note_read("saas_provisioning_log", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO saas_provisioning_log (id, workspace_id, step, status, details, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<String, _>("step"))
        .bind(r.get::<String, _>("status"))
        .bind(r.try_get::<Value, _>("details").unwrap_or(Value::Null))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("saas_provisioning_log", written);
    report.note_skipped("saas_provisioning_log", skipped);
    info!(read = rows.len(), written, skipped, "saas_provisioning_log");
    Ok(written)
}
