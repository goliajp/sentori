//! Project admin endpoints:
//!
//! - `POST   /admin/api/projects` — create
//! - `GET    /admin/api/projects/:project_id` — get one
//! - `PATCH  /admin/api/projects/:project_id` — update (name)
//! - `DELETE /admin/api/projects/:project_id` — delete (cascades)
//!
//! Combined with `GET /v1/projects` (list, already exposed) this
//! is the full project CRUD surface dashboard needs.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use sentori_workspace_identity::ProjectId;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tracing::{info, warn};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    pub name: String,
    pub slug: String,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBody>,
) -> (StatusCode, Json<Value>) {
    if body.name.is_empty() || body.slug.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name + slug required" })),
        );
    }
    // Salt is 32 random bytes (sentori_privacy_salt::Salt::generate()
    // pattern); use a deterministic placeholder here — workspace-
    // identity's projects.create accepts arbitrary bytes.
    let salt = [0xa5u8; 32];
    match state
        .identity
        .projects()
        .create(&body.name, &body.slug, &salt)
        .await
    {
        Ok(p) => {
            info!(
                project_id = %p.id,
                slug = %body.slug,
                "admin.projects created",
            );
            (
                StatusCode::CREATED,
                Json(json!({
                    "id": p.id.to_string(),
                    "name": p.name,
                    "slug": p.slug,
                    "created_at": p.created_at,
                })),
            )
        }
        Err(e) => {
            warn!(error = %e, "admin.projects create_failed");
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            )
        }
    }
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
) -> (StatusCode, Json<Value>) {
    match state
        .identity
        .projects()
        .find(ProjectId::from_uuid(project_id))
        .await
    {
        Ok(Some(p)) => (
            StatusCode::OK,
            Json(json!({
                "id": p.id.to_string(),
                "name": p.name,
                "slug": p.slug,
                "created_at": p.created_at,
            })),
        ),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "project_not_found" })),
        ),
        Err(e) => {
            warn!(error = %e, "admin.projects get_failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBody {
    pub name: Option<String>,
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<UpdateBody>,
) -> (StatusCode, Json<Value>) {
    let Some(name) = body.name else {
        return (StatusCode::OK, Json(json!({ "status": "noop" })));
    };
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name must not be empty" })),
        );
    }
    let result = sqlx::query("UPDATE projects SET name = $1 WHERE id = $2 RETURNING id")
        .bind(&name)
        .bind(project_id)
        .fetch_optional(&state.pool)
        .await;
    match result {
        Ok(Some(row)) => {
            let id: Uuid = row.get("id");
            info!(%id, "admin.projects renamed");
            (StatusCode::OK, Json(json!({ "id": id.to_string(), "name": name })))
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "project_not_found" })),
        ),
        Err(e) => {
            warn!(error = %e, "admin.projects update_failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
) -> StatusCode {
    match state
        .identity
        .projects()
        .delete(ProjectId::from_uuid(project_id))
        .await
    {
        Ok(()) => {
            info!(%project_id, "admin.projects deleted");
            StatusCode::NO_CONTENT
        }
        Err(e) => {
            warn!(error = %e, "admin.projects delete_failed");
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
