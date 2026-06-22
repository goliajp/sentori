//! GET /v1/projects/:project_id/events — recent event tail.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize, Default)]
pub struct ListQuery {
    /// Optional issue filter.
    pub issue_id: Option<Uuid>,
    /// Max rows (default 50, max 500).
    pub limit: Option<u32>,
}

#[derive(Serialize)]
pub struct EventRow {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub kind: String,
    pub timestamp: OffsetDateTime,
    pub release: String,
    pub environment: String,
    pub platform: String,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<EventRow>>, (StatusCode, String)> {
    let limit = q.limit.unwrap_or(50).min(500);

    let sql = if q.issue_id.is_some() {
        "SELECT id, issue_id, kind, timestamp, release, environment, platform
         FROM events
         WHERE project_id = $1 AND issue_id = $2
         ORDER BY timestamp DESC LIMIT $3"
    } else {
        "SELECT id, issue_id, kind, timestamp, release, environment, platform
         FROM events
         WHERE project_id = $1
         ORDER BY timestamp DESC LIMIT $3"
    };

    let rows: Vec<(Uuid, Uuid, String, OffsetDateTime, String, String, String)> =
        if let Some(iid) = q.issue_id {
            sqlx::query_as(sql)
                .bind(project_id)
                .bind(iid)
                .bind(i64::from(limit))
                .fetch_all(&state.pool)
                .await
        } else {
            sqlx::query_as(sql)
                .bind(project_id)
                .bind(Option::<Uuid>::None)
                .bind(i64::from(limit))
                .fetch_all(&state.pool)
                .await
        }
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(id, issue_id, kind, timestamp, release, environment, platform)| EventRow {
                    id,
                    issue_id,
                    kind,
                    timestamp,
                    release,
                    environment,
                    platform,
                },
            )
            .collect(),
    ))
}
