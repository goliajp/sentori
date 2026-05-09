use axum::{
    extract::{Json, Path, Query, State},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IssueRow {
    pub id: Uuid,
    pub fingerprint: String,
    pub error_type: String,
    pub message_sample: String,
    pub status: String,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
    pub event_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIssuesQuery {
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub limit: Option<i64>,
}

fn default_status() -> String {
    "active".to_string()
}

pub async fn list_issues(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListIssuesQuery>,
) -> Result<Json<Vec<IssueRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);

    let rows: Vec<IssueRow> = sqlx::query_as(
        r#"
        SELECT id, fingerprint, error_type, message_sample, status,
               first_seen, last_seen, event_count
        FROM issues
        WHERE project_id = $1 AND status = $2
        ORDER BY last_seen DESC
        LIMIT $3
        "#,
    )
    .bind(project_id)
    .bind(&q.status)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(rows))
}

pub async fn issue_detail(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<IssueRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    let row: Option<IssueRow> = sqlx::query_as(
        r#"
        SELECT id, fingerprint, error_type, message_sample, status,
               first_seen, last_seen, event_count
        FROM issues
        WHERE project_id = $1 AND id = $2
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    row.map(Json).ok_or(AppError::NotFound)
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub received_at: OffsetDateTime,
    pub platform: String,
    pub release: String,
    pub environment: String,
    pub error_type: String,
    pub error_message: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

pub async fn list_events_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<ListEventsQuery>,
) -> Result<Json<Vec<EventRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);

    let rows: Vec<EventRow> = sqlx::query_as(
        r#"
        SELECT id, occurred_at, received_at, platform, release, environment,
               error_type, error_message, payload
        FROM events
        WHERE project_id = $1 AND issue_id = $2
        ORDER BY received_at DESC
        LIMIT $3
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(rows))
}
