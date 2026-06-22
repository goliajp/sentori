//! GET /v1/projects — list projects (v0.1 anonymous read
//! for the skeleton; auth middleware lands in Phase 4
//! once cookie session is wired into a session middleware).

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
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
) -> Result<Json<Vec<ProjectRow>>, (StatusCode, String)> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, slug, name FROM projects ORDER BY created_at ASC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, slug, name)| ProjectRow { id, slug, name })
            .collect(),
    ))
}
