//! Identity extras — saved_view_shares (collaborator ACL),
//! identity_scopes (OAuth scope grants), identity_merges
//! (cross-provider user merges).

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
    total += saved_view_shares(src, dst, dry_run, report).await?;
    total += identity_scopes(src, dst, dry_run, report).await?;
    total += identity_merges(src, dst, dry_run, report).await?;
    total += pii_log(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn saved_view_shares(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT saved_view_id, user_id, granted_at, granted_by FROM saved_view_shares",
    )
    .fetch_all(src)
    .await?;
    report.note_read("saved_view_shares", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO saved_view_shares (saved_view_id, user_id, granted_at, granted_by) \
             VALUES ($1, $2, $3, $4) ON CONFLICT (saved_view_id, user_id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("saved_view_id"))
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.get::<time::OffsetDateTime, _>("granted_at"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("granted_by").ok().flatten())
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("saved_view_shares", written);
    report.note_skipped("saved_view_shares", skipped);
    info!(read = rows.len(), written, skipped, "saved_view_shares");
    Ok(written)
}

async fn identity_scopes(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, user_id, provider, scope, granted_at \
         FROM identity_scopes",
    )
    .fetch_all(src)
    .await?;
    report.note_read("identity_scopes", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO identity_scopes (id, user_id, provider, scope, granted_at) \
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.get::<String, _>("provider"))
        .bind(r.get::<String, _>("scope"))
        .bind(r.get::<time::OffsetDateTime, _>("granted_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("identity_scopes", written);
    report.note_skipped("identity_scopes", skipped);
    info!(read = rows.len(), written, skipped, "identity_scopes");
    Ok(written)
}

async fn identity_merges(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, src_user_id, dst_user_id, merged_at, merged_by, reason \
         FROM identity_merges",
    )
    .fetch_all(src)
    .await?;
    report.note_read("identity_merges", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO identity_merges (id, src_user_id, dst_user_id, merged_at, merged_by, reason) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("src_user_id"))
        .bind(r.get::<uuid::Uuid, _>("dst_user_id"))
        .bind(r.get::<time::OffsetDateTime, _>("merged_at"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("merged_by").ok().flatten())
        .bind(r.try_get::<Option<String>, _>("reason").ok().flatten())
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("identity_merges", written);
    report.note_skipped("identity_merges", skipped);
    info!(read = rows.len(), written, skipped, "identity_merges");
    Ok(written)
}

async fn pii_log(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT pl.id, p.org_id AS workspace_id, pl.project_id, pl.event_id, \
                pl.action, pl.actor_user_id, pl.details, pl.created_at \
         FROM pii_log pl LEFT JOIN projects p ON p.id = pl.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("pii_log", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO pii_log (id, workspace_id, project_id, event_id, action, actor_user_id, details, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("workspace_id").ok().flatten())
        .bind(r.try_get::<Option<uuid::Uuid>, _>("project_id").ok().flatten())
        .bind(r.try_get::<Option<uuid::Uuid>, _>("event_id").ok().flatten())
        .bind(r.get::<String, _>("action"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("actor_user_id").ok().flatten())
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
    report.note_written("pii_log", written);
    report.note_skipped("pii_log", skipped);
    info!(read = rows.len(), written, skipped, "pii_log");
    Ok(written)
}
