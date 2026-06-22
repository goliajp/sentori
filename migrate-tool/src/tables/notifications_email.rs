//! Email notification tables — notifications_email_log,
//! notifications_email_preferences, digest_email_log.
//! Operational ledger; preserved on cutover.

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
    total += email_log(src, dst, dry_run, report).await?;
    total += email_prefs(src, dst, dry_run, report).await?;
    total += digest_log(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn email_log(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, user_id, kind, subject, status, error, sent_at, created_at \
         FROM notifications_email_log ORDER BY created_at DESC LIMIT 50000",
    )
    .fetch_all(src)
    .await?;
    report.note_read("notifications_email_log", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO notifications_email_log (id, user_id, kind, subject, status, error, sent_at, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.get::<String, _>("kind"))
        .bind(r.try_get::<Option<String>, _>("subject").ok().flatten())
        .bind(r.get::<String, _>("status"))
        .bind(r.try_get::<Option<String>, _>("error").ok().flatten())
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("sent_at").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("notifications_email_log", written);
    report.note_skipped("notifications_email_log", skipped);
    info!(read = rows.len(), written, skipped, "notifications_email_log");
    Ok(written)
}

async fn email_prefs(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT user_id, category, opted_out, updated_at FROM notifications_email_preferences",
    )
    .fetch_all(src)
    .await?;
    report.note_read("notifications_email_preferences", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO notifications_email_preferences (user_id, category, opted_out, updated_at) \
             VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, category) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("user_id"))
        .bind(r.get::<String, _>("category"))
        .bind(r.get::<bool, _>("opted_out"))
        .bind(r.get::<time::OffsetDateTime, _>("updated_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("notifications_email_preferences", written);
    report.note_skipped("notifications_email_preferences", skipped);
    info!(read = rows.len(), written, skipped, "notifications_email_preferences");
    Ok(written)
}

async fn digest_log(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, subscription_id, status, error, sent_at, created_at \
         FROM digest_email_log ORDER BY created_at DESC LIMIT 50000",
    )
    .fetch_all(src)
    .await?;
    report.note_read("digest_email_log", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO digest_email_log (id, subscription_id, status, error, sent_at, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("subscription_id"))
        .bind(r.get::<String, _>("status"))
        .bind(r.try_get::<Option<String>, _>("error").ok().flatten())
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("sent_at").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("digest_email_log", written);
    report.note_skipped("digest_email_log", skipped);
    info!(read = rows.len(), written, skipped, "digest_email_log");
    Ok(written)
}
