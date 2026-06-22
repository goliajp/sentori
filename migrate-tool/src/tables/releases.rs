//! releases + release_artifacts (deploy markers + symbolicator
//! blob metadata).

use anyhow::Result;
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
    total += releases(src, dst, dry_run, report).await?;
    total += release_artifacts(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn releases(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT r.id, p.org_id, r.project_id, r.name, r.created_at, r.deploy_at \
         FROM releases r JOIN projects p ON p.id = r.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("releases", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO releases (id, workspace_id, project_id, name, created_at, deploy_at) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("org_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<String, _>("name"))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("deploy_at").ok().flatten())
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("releases", written);
    report.note_skipped("releases", skipped);
    info!(read = rows.len(), written, skipped, "releases");
    Ok(written)
}

async fn release_artifacts(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    // legacy release_artifacts columns: id, release_id, kind, name, content_hash,
    // blob_path, size_bytes, created_at + (v0.7) entry_count, uncompressed_size_bytes
    // + (later) module_label. We pass through everything via direct column copy.
    let rows = sqlx::query(
        "SELECT ra.*, p.org_id AS workspace_id \
         FROM release_artifacts ra \
         JOIN releases r ON r.id = ra.release_id \
         JOIN projects p ON p.id = r.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("release_artifacts", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for row in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO release_artifacts (id, workspace_id, release_id, kind, name, \
                content_hash, blob_path, size_bytes, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING",
        )
        .bind(row.get::<uuid::Uuid, _>("id"))
        .bind(row.get::<uuid::Uuid, _>("workspace_id"))
        .bind(row.get::<uuid::Uuid, _>("release_id"))
        .bind(row.get::<String, _>("kind"))
        .bind(row.get::<String, _>("name"))
        .bind(row.get::<String, _>("content_hash"))
        .bind(row.get::<String, _>("blob_path"))
        .bind(row.try_get::<i64, _>("size_bytes").unwrap_or(0))
        .bind(row.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("release_artifacts", written);
    report.note_skipped("release_artifacts", skipped);
    info!(read = rows.len(), written, skipped, "release_artifacts");
    Ok(written)
}
