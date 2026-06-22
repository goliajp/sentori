//! Dashboard / admin tables — saved_views, alert_rules,
//! integrations, audit_logs, watchers, notifications,
//! activity_log. All INSERT-透传 with workspace_id derived via
//! projects FK subquery.

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
    total += saved_views(src, dst, dry_run, report).await?;
    total += alert_rules(src, dst, dry_run, report).await?;
    total += integrations(src, dst, dry_run, report).await?;
    total += audit_logs(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn saved_views(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT sv.id, p.org_id AS workspace_id, sv.project_id, sv.target, sv.scope, \
                sv.user_id, sv.name, sv.payload, sv.created_at, sv.created_by, sv.updated_at \
         FROM saved_views sv LEFT JOIN projects p ON p.id = sv.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("saved_views", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO saved_views (id, workspace_id, project_id, target, scope, user_id, \
                name, payload, created_at, created_by, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("workspace_id").ok().flatten())
        .bind(r.try_get::<Option<uuid::Uuid>, _>("project_id").ok().flatten())
        .bind(r.get::<String, _>("target"))
        .bind(r.get::<String, _>("scope"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("user_id").ok().flatten())
        .bind(r.get::<String, _>("name"))
        .bind(r.try_get::<Value, _>("payload").unwrap_or(Value::Null))
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("created_by").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("updated_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("saved_views", written);
    report.note_skipped("saved_views", skipped);
    info!(read = rows.len(), written, skipped, "saved_views");
    Ok(written)
}

async fn alert_rules(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT ar.id, COALESCE(p.org_id, '00000000-0000-0000-0000-000000000000'::uuid) AS workspace_id, \
                ar.project_id, ar.name, ar.enabled, ar.trigger_kind, ar.trigger_config, \
                ar.filter_config, ar.channels, ar.throttle_minutes, ar.last_fired_at, \
                ar.muted, ar.snoozed_until, ar.created_at, ar.created_by, ar.updated_at \
         FROM alert_rules ar LEFT JOIN projects p ON p.id = ar.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("alert_rules", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO alert_rules (id, workspace_id, project_id, name, enabled, \
                trigger_kind, trigger_config, filter_config, channels, throttle_minutes, \
                last_fired_at, muted, snoozed_until, created_at, created_by, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("project_id").ok().flatten())
        .bind(r.get::<String, _>("name"))
        .bind(r.try_get::<bool, _>("enabled").unwrap_or(true))
        .bind(r.get::<String, _>("trigger_kind"))
        .bind(r.try_get::<Value, _>("trigger_config").unwrap_or(Value::Null))
        .bind(r.try_get::<Value, _>("filter_config").unwrap_or(Value::Null))
        .bind(r.try_get::<Value, _>("channels").unwrap_or(Value::Null))
        .bind(r.try_get::<i32, _>("throttle_minutes").unwrap_or(10))
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("last_fired_at").ok().flatten())
        .bind(r.try_get::<bool, _>("muted").unwrap_or(false))
        .bind(r.try_get::<Option<time::OffsetDateTime>, _>("snoozed_until").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("created_at"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("created_by").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("updated_at"))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("alert_rules", written);
    report.note_skipped("alert_rules", skipped);
    info!(read = rows.len(), written, skipped, "alert_rules");
    Ok(written)
}

async fn integrations(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT i.id, p.org_id AS workspace_id, i.project_id, i.kind, i.config, \
                i.connected_by, i.connected_at, i.active \
         FROM integrations i JOIN projects p ON p.id = i.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("integrations", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO integrations (id, workspace_id, project_id, kind, config, \
                connected_by, connected_at, active) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.get::<uuid::Uuid, _>("project_id"))
        .bind(r.get::<String, _>("kind"))
        .bind(r.try_get::<Value, _>("config").unwrap_or(Value::Null))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("connected_by").ok().flatten())
        .bind(r.get::<time::OffsetDateTime, _>("connected_at"))
        .bind(r.try_get::<bool, _>("active").unwrap_or(true))
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("integrations", written);
    report.note_skipped("integrations", skipped);
    info!(read = rows.len(), written, skipped, "integrations");
    Ok(written)
}

async fn audit_logs(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT al.id, COALESCE(p.org_id, '00000000-0000-0000-0000-000000000000'::uuid) AS workspace_id, \
                al.project_id, al.actor_user_id, al.action, al.target_type, al.target_id, \
                al.payload, al.created_at \
         FROM audit_logs al LEFT JOIN projects p ON p.id = al.project_id",
    )
    .fetch_all(src)
    .await?;
    report.note_read("audit_logs", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let res = sqlx::query(
            "INSERT INTO audit_logs (id, workspace_id, project_id, actor_user_id, action, \
                target_type, target_id, payload, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING",
        )
        .bind(r.get::<uuid::Uuid, _>("id"))
        .bind(r.get::<uuid::Uuid, _>("workspace_id"))
        .bind(r.try_get::<Option<uuid::Uuid>, _>("project_id").ok().flatten())
        .bind(r.try_get::<Option<uuid::Uuid>, _>("actor_user_id").ok().flatten())
        .bind(r.get::<String, _>("action"))
        .bind(r.try_get::<Option<String>, _>("target_type").ok().flatten())
        .bind(r.try_get::<Option<String>, _>("target_id").ok().flatten())
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
    report.note_written("audit_logs", written);
    report.note_skipped("audit_logs", skipped);
    info!(read = rows.len(), written, skipped, "audit_logs");
    Ok(written)
}
