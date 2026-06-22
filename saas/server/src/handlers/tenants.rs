//! /v1/saas/workspaces — saasadmin tenant (workspace) CRUD.
//!
//! After the 2026-06-22 row-level pivot, "tenants" are no longer
//! per-DB. They're just rows in the shared `workspaces` table
//! (created by self-hosted's `0001_workspace_identity.sql`) with
//! their workspace_id used to filter every other row across the
//! shared DB via app-level scoping.
//!
//! This handler runs in `sentori-saas-control` (SaaS-only
//! binary) and exposes the saasadmin cross-tenant view.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use time::OffsetDateTime;
use tracing::info;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Serialize)]
pub struct WorkspaceRow {
    pub id: Uuid,
    pub name: String,
    pub created_at: OffsetDateTime,
    /// Billing-table-driven status; defaults to "active" when no
    /// billing row exists yet.
    pub status: String,
    /// Aggregate project count (workspace-scoped).
    pub project_count: i64,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<WorkspaceRow>>, (StatusCode, String)> {
    let rows = sqlx::query(
        "SELECT w.id, w.name, w.created_at, \
                COALESCE(wb.status, 'active') AS status, \
                COALESCE((SELECT COUNT(*) FROM projects WHERE workspace_id = w.id), 0) AS project_count \
         FROM workspaces w \
         LEFT JOIN workspace_billing wb ON wb.workspace_id = w.id \
         ORDER BY w.created_at DESC LIMIT 500",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(
        rows.iter()
            .map(|r| WorkspaceRow {
                id: r.get("id"),
                name: r.get("name"),
                created_at: r.get("created_at"),
                status: r.get("status"),
                project_count: r.get("project_count"),
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    pub name: String,
    #[serde(default)]
    pub owner_email: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResponse {
    pub id: Uuid,
    pub name: String,
    pub status: String,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<CreateResponse>), (StatusCode, String)> {
    if body.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "name required".into()));
    }
    let id = Uuid::now_v7();

    // INSERT workspaces row (uses the shared sentori-server DB).
    sqlx::query("INSERT INTO workspaces (id, name) VALUES ($1, $2)")
        .bind(id)
        .bind(body.name.trim())
        .execute(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Bootstrap a billing row at "active" / "free" plan. Stripe
    // wiring lives in stripe_webhook.rs; this is the initial seed
    // before any payment event.
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

pub async fn suspend(
    State(state): State<Arc<AppState>>,
    Path(workspace_id): Path<Uuid>,
) -> StatusCode {
    let result = sqlx::query(
        "UPDATE workspace_billing SET status = 'past_due', updated_at = now() \
         WHERE workspace_id = $1",
    )
    .bind(workspace_id)
    .execute(&state.pool)
    .await;
    match result {
        Ok(_) => {
            info!(%workspace_id, "saas.workspaces suspended");
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn resume(
    State(state): State<Arc<AppState>>,
    Path(workspace_id): Path<Uuid>,
) -> StatusCode {
    let result = sqlx::query(
        "UPDATE workspace_billing SET status = 'active', updated_at = now() \
         WHERE workspace_id = $1",
    )
    .bind(workspace_id)
    .execute(&state.pool)
    .await;
    match result {
        Ok(_) => {
            info!(%workspace_id, "saas.workspaces resumed");
            StatusCode::NO_CONTENT
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn delete(
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
