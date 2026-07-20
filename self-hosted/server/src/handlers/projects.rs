//! GET /v1/projects — list the caller's workspace's projects.
//!
//! Was an unscoped `SELECT ... FROM projects`, so it returned every
//! tenant's projects to any caller and handed out the ids the rest
//! of the dashboard API addresses data by.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use serde::Serialize;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Serialize)]
pub struct ProjectRow {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<crate::session_mw::SessionContext>,
) -> Result<Json<Vec<ProjectRow>>, (StatusCode, String)> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, slug, name FROM projects \
         WHERE workspace_id = $1 ORDER BY created_at ASC",
    )
    .bind(ctx.workspace_id.into_uuid())
    .fetch_all(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, slug, name)| ProjectRow { id, slug, name })
            .collect(),
    ))
}
