//! GET /v1/projects/:project_id/issues — K5 issue list.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use sentori_workspace_identity::ProjectId;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize, Default)]
pub struct ListQuery {
    /// Optional status filter — `active` / `resolved` /
    /// `regressed` / `ignored`.
    pub status: Option<String>,
    /// Max rows (default 100, max 500).
    pub limit: Option<u32>,
}

#[derive(Serialize)]
pub struct IssueRow {
    pub id: Uuid,
    pub fingerprint: String,
    pub error_type: String,
    pub message_sample: String,
    pub kind: String,
    pub status: String,
    pub event_count: i64,
    pub first_seen: OffsetDateTime,
    pub last_seen: OffsetDateTime,
    pub last_release: String,
    pub last_environment: String,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<IssueRow>>, (StatusCode, String)> {
    let _pid = ProjectId::from_uuid(project_id);
    let limit = q.limit.unwrap_or(100).min(500);

    let sql = if q.status.is_some() {
        "SELECT id, fingerprint, error_type, message_sample, kind, status,
                event_count, first_seen, last_seen, last_release, last_environment
         FROM issues WHERE project_id = $1 AND status = $2
         ORDER BY last_seen DESC LIMIT $3"
    } else {
        "SELECT id, fingerprint, error_type, message_sample, kind, status,
                event_count, first_seen, last_seen, last_release, last_environment
         FROM issues WHERE project_id = $1
         ORDER BY last_seen DESC LIMIT $3"
    };

    let rows: Vec<(
        Uuid,
        String,
        String,
        String,
        String,
        String,
        i64,
        OffsetDateTime,
        OffsetDateTime,
        String,
        String,
    )> = if let Some(status) = q.status.as_deref() {
        sqlx::query_as(sql)
            .bind(project_id)
            .bind(status)
            .bind(i64::from(limit))
            .fetch_all(&state.pool)
            .await
    } else {
        sqlx::query_as(sql)
            .bind(project_id)
            .bind(Option::<String>::None)
            .bind(i64::from(limit))
            .fetch_all(&state.pool)
            .await
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(
        rows.into_iter()
            .map(
                |(
                    id,
                    fingerprint,
                    error_type,
                    message_sample,
                    kind,
                    status,
                    event_count,
                    first_seen,
                    last_seen,
                    last_release,
                    last_environment,
                )| IssueRow {
                    id,
                    fingerprint,
                    error_type,
                    message_sample,
                    kind,
                    status,
                    event_count,
                    first_seen,
                    last_seen,
                    last_release,
                    last_environment,
                },
            )
            .collect(),
    ))
}
