// v1.4 W24 — per-org label catalog CRUD.
//
// Stored in `org_labels` (one row per (org, name)). Endpoints scope
// by org via the slug in the path. Mutations require owner/admin
// role; reads are visible to all org members.

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct OrgLabelRow {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub sla_priority_hours: Option<i32>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelBody {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub sla_priority_hours: Option<i32>,
}

/// `GET /admin/api/orgs/{org_slug}/labels` — list catalog for the org.
pub async fn list_labels(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(org_slug): Path<String>,
) -> Result<Json<Vec<OrgLabelRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let org_id = resolve_org_id_for_caller(pool, &caller, &org_slug).await?;
    let rows: Vec<OrgLabelRow> = sqlx::query_as(
        "SELECT id, name, color, sla_priority_hours, created_at \
         FROM org_labels WHERE org_id = $1 ORDER BY name ASC",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("list labels: {e}")))?;
    Ok(Json(rows))
}

/// `POST /admin/api/orgs/{org_slug}/labels` — create.
pub async fn create_label(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(org_slug): Path<String>,
    Json(body): Json<LabelBody>,
) -> Result<Json<OrgLabelRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let org_id = resolve_org_id_for_caller_admin(pool, &caller, &org_slug).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Internal("label name is required".into()));
    }
    if name.len() > 64 {
        return Err(AppError::Internal("label name max 64 chars".into()));
    }
    let row: OrgLabelRow = sqlx::query_as(
        "INSERT INTO org_labels (id, org_id, name, color, sla_priority_hours) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING id, name, color, sla_priority_hours, created_at",
    )
    .bind(Uuid::now_v7())
    .bind(org_id)
    .bind(&name)
    .bind(body.color.as_deref())
    .bind(body.sla_priority_hours)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(format!("create label: {e}")))?;
    Ok(Json(row))
}

/// `PATCH /admin/api/orgs/{org_slug}/labels/{id}` — partial update.
pub async fn update_label(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((org_slug, id)): Path<(String, Uuid)>,
    Json(body): Json<LabelBody>,
) -> Result<Json<OrgLabelRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let org_id = resolve_org_id_for_caller_admin(pool, &caller, &org_slug).await?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Internal("label name is required".into()));
    }
    let row: Option<OrgLabelRow> = sqlx::query_as(
        "UPDATE org_labels SET name = $3, color = $4, sla_priority_hours = $5, \
             updated_at = now() \
         WHERE id = $1 AND org_id = $2 \
         RETURNING id, name, color, sla_priority_hours, created_at",
    )
    .bind(id)
    .bind(org_id)
    .bind(&name)
    .bind(body.color.as_deref())
    .bind(body.sla_priority_hours)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("update label: {e}")))?;
    row.map(Json).ok_or(AppError::NotFound)
}

/// `DELETE /admin/api/orgs/{org_slug}/labels/{id}`. Idempotent.
pub async fn delete_label(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((org_slug, id)): Path<(String, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let org_id = resolve_org_id_for_caller_admin(pool, &caller, &org_slug).await?;
    sqlx::query("DELETE FROM org_labels WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(org_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("delete label: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

// ── helpers ────────────────────────────────────────────────────────

async fn resolve_org_id_for_caller(
    pool: &PgPool,
    caller: &AdminCaller,
    org_slug: &str,
) -> Result<Uuid, AppError> {
    match caller {
        AdminCaller::User { id, .. } => {
            let row: Option<(Uuid,)> = sqlx::query_as(
                "SELECT o.id FROM orgs o \
                 JOIN memberships m ON m.org_id = o.id \
                 WHERE o.slug = $1 AND m.user_id = $2",
            )
            .bind(org_slug)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
            row.map(|r| r.0).ok_or(AppError::NotFound)
        }
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => {
            let row: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM orgs WHERE slug = $1")
                .bind(org_slug)
                .fetch_optional(pool)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            row.map(|r| r.0).ok_or(AppError::NotFound)
        }
    }
}

async fn resolve_org_id_for_caller_admin(
    pool: &PgPool,
    caller: &AdminCaller,
    org_slug: &str,
) -> Result<Uuid, AppError> {
    match caller {
        AdminCaller::User { id, .. } => {
            let row: Option<(Uuid, String)> = sqlx::query_as(
                "SELECT o.id, m.role FROM orgs o \
                 JOIN memberships m ON m.org_id = o.id \
                 WHERE o.slug = $1 AND m.user_id = $2",
            )
            .bind(org_slug)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
            let (org_id, role) = row.ok_or(AppError::NotFound)?;
            if !matches!(role.as_str(), "owner" | "admin") {
                return Err(AppError::Forbidden);
            }
            Ok(org_id)
        }
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => {
            let row: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM orgs WHERE slug = $1")
                .bind(org_slug)
                .fetch_optional(pool)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            row.map(|r| r.0).ok_or(AppError::NotFound)
        }
    }
}
