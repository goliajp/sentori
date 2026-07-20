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
//! RBAC: gated by `session_middleware` plus `saasadmin_only`
//! (see `crate::saasadmin_mw`), which restricts the group to the
//! user ids in `SENTORI_SAASADMIN_USER_IDS`.
//!
//! Workspace create / delete / suspend / resume moved here from
//! the `sentori-saas-control` binary, which had its own account
//! system and no UI calling it. That binary is now only the
//! Stripe webhook receiver.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use tracing::{info, warn};
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResponse {
    pub id: Uuid,
    pub name: String,
    pub status: String,
}

pub async fn create_workspace(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<CreateResponse>), (StatusCode, String)> {
    if body.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "name required".into()));
    }
    let id = Uuid::now_v7();

    sqlx::query("INSERT INTO workspaces (id, name) VALUES ($1, $2)")
        .bind(id)
        .bind(body.name.trim())
        .execute(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Bootstrap a billing row at "active" / "free" plan. Stripe
    // wiring lives in the saas-control webhook receiver; this is
    // the initial seed before any payment event.
    let billing_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO workspace_billing (id, workspace_id, plan, status) \
         VALUES ($1, $2, 'free', 'active') ON CONFLICT (workspace_id) DO NOTHING",
    )
    .bind(billing_id)
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    info!(workspace_id = %id, name = %body.name, "saas.workspaces created");
    Ok((
        StatusCode::CREATED,
        Json(CreateResponse {
            id,
            name: body.name.trim().to_string(),
            status: "active".into(),
        }),
    ))
}

pub async fn delete_workspace(
    State(state): State<Arc<AppState>>,
    Path(workspace_id): Path<Uuid>,
) -> StatusCode {
    // Hard delete cascades via FK (workspaces.id → projects.workspace_id
    // → events.workspace_id, etc. all ON DELETE CASCADE).
    let result = sqlx::query("DELETE FROM workspaces WHERE id = $1")
        .bind(workspace_id)
        .execute(&state.pool)
        .await;
    match result {
        Ok(_) => {
            info!(%workspace_id, "saas.workspaces deleted");
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn suspend_workspace(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Row-level pivot: status lives on workspace_billing now.
    let res = sqlx::query(
        "UPDATE workspace_billing SET status = 'past_due', updated_at = now() \
         WHERE workspace_id = $1 AND status = 'active'",
    )
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if res.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "workspace billing row not active / missing".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn resume_workspace(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let res = sqlx::query(
        "UPDATE workspace_billing SET status = 'active', updated_at = now() \
         WHERE workspace_id = $1 AND status = 'past_due'",
    )
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if res.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "workspace billing row not past_due / missing".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}
