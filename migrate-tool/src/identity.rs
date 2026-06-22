//! Identity layer ETL: orgs → workspaces, users, memberships,
//! projects, privacy_salts.
//!
//! Per inventory §5:
//! - legacy `orgs.id` → v0.2 `workspaces.id` (same UUID, table
//!   rename only)
//! - legacy `memberships.role` 4 levels (owner/admin/member/
//!   viewer) → v0.2 `workspace_members.role` 3 levels (viewer →
//!   user, member → user) — preserves read-only audit semantics
//!   via downstream ACL
//! - legacy `teams` / `team_memberships` / `project_teams` — NOT
//!   migrated in v0.2 (API hidden per §5.2; data preserved in
//!   legacy DB for future re-enable)
//!
//! Idempotent: ON CONFLICT (id) DO NOTHING throughout, so re-runs
//! after partial failure don't double-write.

use anyhow::Result;
use sqlx::{PgPool, Row};
use tracing::info;

use crate::report::Report;

pub async fn migrate_all(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let mut total: u64 = 0;
    total += orgs_to_workspaces(src, dst, dry_run, report).await?;
    total += users(src, dst, dry_run, report).await?;
    total += memberships(src, dst, dry_run, report).await?;
    total += privacy_salts(src, dst, dry_run, report).await?;
    total += projects(src, dst, dry_run, report).await?;
    Ok(total)
}

async fn orgs_to_workspaces(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query("SELECT id, name, created_at FROM orgs")
        .fetch_all(src)
        .await?;
    report.note_read("orgs→workspaces", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let id: uuid::Uuid = r.get("id");
        let name: String = r.get("name");
        let created_at: time::OffsetDateTime = r.get("created_at");
        let res = sqlx::query(
            "INSERT INTO workspaces (id, name, created_at) VALUES ($1, $2, $3) \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(&name)
        .bind(created_at)
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("orgs→workspaces", written);
    report.note_skipped("orgs→workspaces", skipped);
    info!(read = rows.len(), written, skipped, "orgs→workspaces");
    Ok(written)
}

async fn users(src: &PgPool, dst: &PgPool, dry_run: bool, report: &mut Report) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, email, password_hash, email_verified, created_at FROM users",
    )
    .fetch_all(src)
    .await?;
    report.note_read("users", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let id: uuid::Uuid = r.get("id");
        let email: String = r.get("email");
        let password_hash: String = r.get("password_hash");
        let email_verified: bool = r.get("email_verified");
        let created_at: time::OffsetDateTime = r.get("created_at");
        let res = sqlx::query(
            "INSERT INTO users (id, email, password_hash, email_verified, created_at) \
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(&email)
        .bind(&password_hash)
        .bind(email_verified)
        .bind(created_at)
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("users", written);
    report.note_skipped("users", skipped);
    info!(read = rows.len(), written, skipped, "users");
    Ok(written)
}

async fn memberships(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT user_id, org_id, role, added_by, added_at FROM memberships",
    )
    .fetch_all(src)
    .await?;
    report.note_read("memberships", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let user_id: uuid::Uuid = r.get("user_id");
        let workspace_id: uuid::Uuid = r.get("org_id");
        let legacy_role: String = r.get("role");
        let role = map_role(&legacy_role);
        let added_by: Option<uuid::Uuid> = r.try_get("added_by").ok();
        let added_at: time::OffsetDateTime = r.get("added_at");

        let res = sqlx::query(
            "INSERT INTO workspace_members (workspace_id, user_id, role, added_by, added_at) \
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        )
        .bind(workspace_id)
        .bind(user_id)
        .bind(role)
        .bind(added_by)
        .bind(added_at)
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("memberships", written);
    report.note_skipped("memberships", skipped);
    info!(read = rows.len(), written, skipped, "memberships");
    Ok(written)
}

/// 4-level → 3-level role mapping.
///
/// - owner / admin → unchanged
/// - member → user (legacy "regular member with write access")
/// - viewer → user (legacy "read-only"; v0.2 enforces read-only
///   via separate ACL layer, role stays at "user" minimum tier)
fn map_role(legacy: &str) -> &'static str {
    match legacy {
        "owner" => "owner",
        "admin" => "admin",
        "member" | "viewer" => "user",
        _ => "user",
    }
}

async fn privacy_salts(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows =
        sqlx::query("SELECT id, org_id, salt_bytes, created_at FROM privacy_salts")
            .fetch_all(src)
            .await?;
    report.note_read("privacy_salts", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let id: uuid::Uuid = r.get("id");
        let workspace_id: uuid::Uuid = r.get("org_id");
        let salt_bytes: Vec<u8> = r.get("salt_bytes");
        let created_at: time::OffsetDateTime = r.get("created_at");
        let res = sqlx::query(
            "INSERT INTO privacy_salts (id, workspace_id, salt_bytes, created_at) \
             VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(workspace_id)
        .bind(&salt_bytes)
        .bind(created_at)
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("privacy_salts", written);
    report.note_skipped("privacy_salts", skipped);
    info!(read = rows.len(), written, skipped, "privacy_salts");
    Ok(written)
}

async fn projects(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let rows = sqlx::query(
        "SELECT id, org_id, name, slug, privacy_salt_id, created_at FROM projects",
    )
    .fetch_all(src)
    .await?;
    report.note_read("projects", rows.len() as u64);
    let mut written = 0u64;
    let mut skipped = 0u64;
    for r in &rows {
        if dry_run {
            continue;
        }
        let id: uuid::Uuid = r.get("id");
        let workspace_id: uuid::Uuid = r.get("org_id");
        let name: String = r.get("name");
        let slug: String = r.get("slug");
        let privacy_salt_id: uuid::Uuid = r.get("privacy_salt_id");
        let created_at: time::OffsetDateTime = r.get("created_at");
        let res = sqlx::query(
            "INSERT INTO projects (id, workspace_id, name, slug, privacy_salt_id, created_at) \
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        )
        .bind(id)
        .bind(workspace_id)
        .bind(&name)
        .bind(&slug)
        .bind(privacy_salt_id)
        .bind(created_at)
        .execute(dst)
        .await?;
        if res.rows_affected() > 0 {
            written += 1;
        } else {
            skipped += 1;
        }
    }
    report.note_written("projects", written);
    report.note_skipped("projects", skipped);
    info!(read = rows.len(), written, skipped, "projects");
    Ok(written)
}
