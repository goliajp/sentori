//! Cross-workspace admin views — for SaaS-mode operators only.
//!
//! `sentori-server` serves both self-hosted (single workspace) and
//! SaaS (many workspaces in shared DB) deployments. These
//! endpoints read across all workspaces, intended for the
//! saasadmin webapp view.
//!
//! Self-hosted operators will see only their one workspace row
//! when calling these — that's fine, the row count is just 1.
//!
//! RBAC: in v0.2 these are gated only by the same session
//! middleware as the rest of /admin/api/*. A role-based admin
//! middleware that further restricts to saasadmin users lands
//! in a follow-up.

use std::sync::Arc;

use axum::{Json, extract::State};
use serde_json::{Value, json};
use sqlx::Row;
use tracing::warn;
use uuid::Uuid;

use crate::state::AppState;

pub async fn workspaces(State(state): State<Arc<AppState>>) -> Json<Value> {
    let rows = sqlx::query(
        "SELECT w.id, w.name, w.created_at, \
                COALESCE(wb.plan, 'free') AS plan, \
                COALESCE(wb.status, 'active') AS status, \
                COALESCE((SELECT COUNT(*) FROM projects WHERE workspace_id = w.id), 0) AS project_count, \
                COALESCE((SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id), 0) AS member_count \
         FROM workspaces w \
         LEFT JOIN workspace_billing wb ON wb.workspace_id = w.id \
         ORDER BY w.created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let out: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id").to_string(),
                "name": r.get::<String, _>("name"),
                "created_at": r.get::<time::OffsetDateTime, _>("created_at"),
                "plan": r.get::<String, _>("plan"),
                "status": r.get::<String, _>("status"),
                "project_count": r.get::<i64, _>("project_count"),
                "member_count": r.get::<i64, _>("member_count"),
            })
        })
        .collect();
    Json(json!({ "workspaces": out }))
}

pub async fn workspace_stats(State(state): State<Arc<AppState>>) -> Json<Value> {
    // Aggregate counts across the deployment.
    let workspaces: i64 = sqlx::query("SELECT COUNT(*) AS n FROM workspaces")
        .fetch_one(&state.pool)
        .await
        .map(|r| r.get("n"))
        .unwrap_or_else(|e| {
            warn!(error = %e, "saas.workspace_stats workspaces query");
            0
        });
    let active: i64 =
        sqlx::query("SELECT COUNT(*) AS n FROM workspace_billing WHERE status = 'active'")
            .fetch_one(&state.pool)
            .await
            .map(|r| r.get("n"))
            .unwrap_or(0);
    let projects: i64 = sqlx::query("SELECT COUNT(*) AS n FROM projects")
        .fetch_one(&state.pool)
        .await
        .map(|r| r.get("n"))
        .unwrap_or(0);
    let users: i64 = sqlx::query("SELECT COUNT(*) AS n FROM users")
        .fetch_one(&state.pool)
        .await
        .map(|r| r.get("n"))
        .unwrap_or(0);
    let events_24h: i64 = sqlx::query(
        "SELECT COUNT(*) AS n FROM events WHERE received_at >= now() - interval '24 hours'",
    )
    .fetch_one(&state.pool)
    .await
    .map(|r| r.get("n"))
    .unwrap_or(0);
    let tokens_active: i64 =
        sqlx::query("SELECT COUNT(*) AS n FROM tokens WHERE revoked_at IS NULL")
            .fetch_one(&state.pool)
            .await
            .map(|r| r.get("n"))
            .unwrap_or(0);
    Json(json!({
        "workspaces": workspaces,
        "active_workspaces": active,
        "projects": projects,
        "users": users,
        "events_24h": events_24h,
        "tokens_active": tokens_active,
    }))
}
