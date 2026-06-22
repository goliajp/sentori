//! event_attachments + dsyms + proguard_mappings.

use anyhow::Result;
use sqlx::{PgPool, Row};
use tracing::info;

use crate::report::Report;

const PAGE: i64 = 1000;

pub async fn migrate(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let mut total = 0u64;
    total += event_attachments(src, dst, dry_run, report).await?;
    total += dsyms(src, dst, dry_run, report).await?;
    total += proguard_mappings(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn event_attachments(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let mut written = 0u64;
    let mut skipped = 0u64;
    let mut offset: i64 = 0;
    loop {
        let rows = sqlx::query(
            "SELECT a.id, p.org_id AS workspace_id, a.project_id, a.event_id, a.kind, \
                    a.content_type, a.size_bytes, a.blob_hash, a.received_at \
             FROM event_attachments a JOIN projects p ON p.id = a.project_id \
             ORDER BY a.received_at LIMIT $1 OFFSET $2",
        )
        .bind(PAGE)
        .bind(offset)
        .fetch_all(src)
        .await?;
        if rows.is_empty() {
            break;
        }
        report.note_read("event_attachments", rows.len() as u64);
        for r in &rows {
            if dry_run {
                continue;
            }
            let res = sqlx::query(
                "INSERT INTO event_attachments (id, workspace_id, project_id, event_id, kind, \
                    content_type, size_bytes, blob_hash, received_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING",
            )
            .bind(r.get::<uuid::Uuid, _>("id"))
            .bind(r.get::<uuid::Uuid, _>("workspace_id"))
            .bind(r.get::<uuid::Uuid, _>("project_id"))
            .bind(r.get::<uuid::Uuid, _>("event_id"))
            .bind(r.get::<String, _>("kind"))
            .bind(r.try_get::<Option<String>, _>("content_type").ok().flatten())
            .bind(r.try_get::<i64, _>("size_bytes").unwrap_or(0))
            .bind(r.get::<String, _>("blob_hash"))
            .bind(r.get::<time::OffsetDateTime, _>("received_at"))
            .execute(dst)
            .await?;
            if res.rows_affected() > 0 {
                written += 1;
            } else {
                skipped += 1;
            }
        }
        info!(offset, page = rows.len(), written, skipped, "event_attachments page");
        offset += PAGE;
        if rows.len() < PAGE as usize {
            break;
        }
    }
    report.note_written("event_attachments", written);
    report.note_skipped("event_attachments", skipped);
    Ok(written)
}

async fn dsyms(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    // Metadata-only ETL — actual blob copy is out-of-band
    // (rsync of the on-disk dsym blob store happens separately).
    let rows = sqlx::query(
        "SELECT d.id, p.org_id AS workspace_id, d.project_id, d.uuid, d.arch, \
                d.image_name, d.bin_kind, d.size_bytes, d.blob_hash, d.uploaded_at \
         FROM dsyms d JOIN projects p ON p.id = d.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("dsyms", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO dsyms (id, workspace_id, project_id, uuid, arch, image_name, \
                bin_kind, size_bytes, blob_hash, uploaded_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<String, _>("uuid"))
        .bind(r.try_get::<Option<String>, _>("arch").ok().flatten())
        .bind(r.try_get::<Option<String>, _>("image_name").ok().flatten())
        .bind(r.try_get::<Option<String>, _>("bin_kind").ok().flatten())
        .bind(r.try_get::<i64, _>("size_bytes").unwrap_or(0))
        .bind(r.get::<String, _>("blob_hash"))
        .bind(r.get::<time::OffsetDateTime, _>("uploaded_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("dsyms", written);
    report.note_skipped("dsyms", skipped);
    info!(read = rows.len(), written, skipped, "dsyms");
    Ok(written)
}

async fn proguard_mappings(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT pm.id, p.org_id AS workspace_id, pm.project_id, pm.uuid, pm.release_id, \
                pm.size_bytes, pm.blob_hash, pm.uploaded_at \
         FROM proguard_mappings pm JOIN projects p ON p.id = pm.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("proguard_mappings", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO proguard_mappings (id, workspace_id, project_id, uuid, release_id, \
                size_bytes, blob_hash, uploaded_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<String, _>("uuid"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("release_id").ok().flatten())
        .bind(r.try_get::<i64, _>("size_bytes").unwrap_or(0))
        .bind(r.get::<String, _>("blob_hash"))
        .bind(r.get::<time::OffsetDateTime, _>("uploaded_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("proguard_mappings", written);
    report.note_skipped("proguard_mappings", skipped);
    info!(read = rows.len(), written, skipped, "proguard_mappings");
    Ok(written)
}
