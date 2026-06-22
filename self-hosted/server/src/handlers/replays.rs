//! GET /v1/projects/:project_id/replays — recent replay sessions

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize, Default)]
pub struct ListQuery {
    pub limit: Option<u32>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let limit = q.limit.unwrap_or(50).clamp(1, 500) as i64;
    let rows = sqlx::query(
        "SELECT id, event_id, blob_hash, started_at, ended_at, frame_count, created_at \
         FROM replay_sessions \
         WHERE project_id = $1 \
         ORDER BY created_at DESC LIMIT $2",
    )
    .bind(project_id)
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let out: Vec<Value> = rows
        .iter()
        .map(|r| {
            let started: OffsetDateTime = r.get("started_at");
            let ended: OffsetDateTime = r.get("ended_at");
            json!({
                "id": r.get::<Uuid, _>("id").to_string(),
                "event_id": r.get::<Uuid, _>("event_id").to_string(),
                "blob_hash": r.get::<String, _>("blob_hash"),
                "started_at": started,
                "ended_at": ended,
                "duration_ms": (ended - started).whole_milliseconds() as i64,
                "frame_count": r.try_get::<i32, _>("frame_count").unwrap_or(0),
                "created_at": r.get::<OffsetDateTime, _>("created_at"),
            })
        })
        .collect();
    Ok(Json(json!({ "replays": out })))
}
