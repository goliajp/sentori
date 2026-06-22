//! Additional dashboard tables — watchers, notifications,
//! activity_log, issue_comments, issue_integration_links,
//! issue_user_mutes.

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
    total += watchers(src, dst, dry_run, report).await?;
    total += notifications(src, dst, dry_run, report).await?;
    total += activity_log(src, dst, dry_run, report).await?;
    total += issue_comments(src, dst, dry_run, report).await?;
    total += issue_integration_links(src, dst, dry_run, report).await?;
    total += issue_user_mutes(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn watchers(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT issue_id, user_id, started_at FROM issue_watchers",
    )
    .fetch_all(src)
    .await?;
    report.note_read("issue_watchers", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO issue_watchers (issue_id, user_id, started_at) \
             VALUES ($1, $2, $3) ON CONFLICT (issue_id, user_id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("issue_id"))
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.get::<time::OffsetDateTime, _>("started_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("issue_watchers", written);
    report.note_skipped("issue_watchers", skipped);
    info!(read = rows.len(), written, skipped, "issue_watchers");
    Ok(written)
}

async fn notifications(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, user_id, kind, payload, read_at, created_at FROM notifications",
    )
    .fetch_all(src)
    .await?;
    report.note_read("notifications", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO notifications (id, user_id, kind, payload, read_at, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.get::<String, _>("kind"))
        .bind(r.try_get::<Value, _>("payload").unwrap_or(Value::Null))
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("read_at").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("notifications", written);
    report.note_skipped("notifications", skipped);
    info!(read = rows.len(), written, skipped, "notifications");
    Ok(written)
}

async fn activity_log(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, issue_id, actor_user_id, kind, payload, created_at FROM activity_log",
    )
    .fetch_all(src)
    .await?;
    report.note_read("activity_log", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO activity_log (id, issue_id, actor_user_id, kind, payload, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("issue_id"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("actor_user_id").ok().flatten())
        .bind(r.get::<String, _>("kind"))
        .bind(r.try_get::<Value, _>("payload").unwrap_or(Value::Null))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("activity_log", written);
    report.note_skipped("activity_log", skipped);
    info!(read = rows.len(), written, skipped, "activity_log");
    Ok(written)
}

async fn issue_comments(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, issue_id, author_user_id, body_md, created_at, edited_at FROM issue_comments",
    )
    .fetch_all(src)
    .await?;
    report.note_read("issue_comments", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO issue_comments (id, issue_id, author_user_id, body_md, created_at, edited_at) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("issue_id"))
        .bind(r.get::<uuid::Uuid, _>("author_user_id"))
        .bind(r.get::<String, _>("body_md"))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("edited_at").ok().flatten())
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("issue_comments", written);
    report.note_skipped("issue_comments", skipped);
    info!(read = rows.len(), written, skipped, "issue_comments");
    Ok(written)
}

async fn issue_integration_links(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, issue_id, integration_id, external_kind, external_ref, external_url, \
                created_at, created_by FROM issue_integration_links",
    )
    .fetch_all(src)
    .await?;
    report.note_read("issue_integration_links", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO issue_integration_links (id, issue_id, integration_id, external_kind, \
                external_ref, external_url, created_at, created_by) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("issue_id"))
        .bind(r.get::<uuid::Uuid, _>("integration_id"))
        .bind(r.get::<String, _>("external_kind"))
        .bind(r.get::<String, _>("external_ref"))
        .bind(r.try_get::<Option<String>, _>("external_url").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("created_by").ok().flatten())
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("issue_integration_links", written);
    report.note_skipped("issue_integration_links", skipped);
    info!(read = rows.len(), written, skipped, "issue_integration_links");
    Ok(written)
}

async fn issue_user_mutes(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, project_id, user_id, until_release, until_at, scope, created_at \
         FROM issue_user_mutes",
    )
    .fetch_all(src)
    .await?;
    report.note_read("issue_user_mutes", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO issue_user_mutes (id, project_id, user_id, until_release, until_at, scope, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.try_get::<Option<String>, _>("until_release").ok().flatten())
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("until_at").ok().flatten())
        .bind(r.try_get::<String, _>("scope").unwrap_or_default())
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("issue_user_mutes", written);
    report.note_skipped("issue_user_mutes", skipped);
    info!(read = rows.len(), written, skipped, "issue_user_mutes");
    Ok(written)
}
