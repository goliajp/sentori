// v0.8.2 — end-user-submitted bug reports.
//
// Ingest path (called from the SDK from inside the host app, after
// the end user taps "report a problem"):
//   POST /v1/user-reports   — auth via ingest token (st_pk_…)
//
// Admin path (called from the dashboard):
//   GET  /admin/api/projects/{project_id}/user-reports
//   GET  /admin/api/projects/{project_id}/issues/{issue_id}/user-reports
//
// Schema lives in migration 0036. Reports without `eventId` land in
// the project Inbox; reports with one are pinned to that event's
// issue automatically (issue_id is filled in by the ingest handler
// using the events→issues mapping if the event_id is known).

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;
use validator::Validate;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Clone, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct UserReportInput {
    /// Optional UUID of an event the user just experienced. When set,
    /// the report is linked to that event's issue automatically so it
    /// shows up on the issue detail's "User reports" tab.
    #[serde(default)]
    pub event_id: Option<Uuid>,

    #[validate(length(min = 1, max = 200))]
    pub title: String,

    #[validate(length(min = 1, max = 8000))]
    pub body: String,

    #[serde(default)]
    #[validate(length(max = 320))]
    pub email: Option<String>,

    #[serde(default)]
    #[validate(length(max = 200))]
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserReportRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub event_id: Option<Uuid>,
    pub issue_id: Option<Uuid>,
    pub title: String,
    pub body: String,
    pub email: Option<String>,
    pub name: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub received_at: OffsetDateTime,
}

/// `POST /v1/user-reports`
pub async fn ingest(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(input): Json<UserReportInput>,
) -> Result<Response, AppError> {
    input.validate().map_err(AppError::Validation)?;
    let project_id = caller_project_id(&caller, &state);
    let id = uuid::Uuid::now_v7();

    // Resolve issue_id by walking events.issue_id when an event_id is
    // supplied. Reports without an event_id land in the Inbox (issue_id
    // stays NULL). If the event_id doesn't exist we still accept the
    // report — the user might submit feedback off a crash we haven't
    // ingested yet (offline) or off no crash at all.
    let issue_id: Option<Uuid> = match (&state.db, input.event_id) {
        (Some(pool), Some(event_id)) => sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT issue_id FROM events \
             WHERE id = $1 AND project_id = $2 LIMIT 1",
        )
        .bind(event_id)
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .flatten(),
        _ => None,
    };

    if let Some(pool) = &state.db {
        let result = sqlx::query(
            "INSERT INTO user_reports \
             (id, project_id, event_id, issue_id, title, body, email, name) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(id)
        .bind(project_id)
        .bind(input.event_id)
        .bind(issue_id)
        .bind(&input.title)
        .bind(&input.body)
        .bind(input.email.as_deref())
        .bind(input.name.as_deref())
        .execute(pool)
        .await;
        if let Err(e) = result {
            tracing::error!(error = %e, "user_report insert failed");
            return Ok(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    }

    tracing::info!(%id, %project_id, ?issue_id, event_id = ?input.event_id, "user_report accepted");
    Ok((
        StatusCode::CREATED,
        Json(json!({ "id": id, "issueId": issue_id })),
    )
        .into_response())
}

/// `GET /admin/api/projects/{project_id}/user-reports?limit=50`
pub async fn list_for_project(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<UserReportRow>::new()).into_response());
    };
    let rows = sqlx::query_as::<_, (Uuid, Uuid, Option<Uuid>, Option<Uuid>, String, String, Option<String>, Option<String>, OffsetDateTime)>(
        "SELECT id, project_id, event_id, issue_id, title, body, email, name, received_at \
         FROM user_reports WHERE project_id = $1 ORDER BY received_at DESC LIMIT 200",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let out: Vec<UserReportRow> = rows
        .into_iter()
        .map(|(id, project_id, event_id, issue_id, title, body, email, name, received_at)| {
            UserReportRow {
                id,
                project_id,
                event_id,
                issue_id,
                title,
                body,
                email,
                name,
                received_at,
            }
        })
        .collect();
    Ok(Json(out).into_response())
}

/// `GET /admin/api/projects/{project_id}/issues/{issue_id}/user-reports`
pub async fn list_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<UserReportRow>::new()).into_response());
    };
    let rows = sqlx::query_as::<_, (Uuid, Uuid, Option<Uuid>, Option<Uuid>, String, String, Option<String>, Option<String>, OffsetDateTime)>(
        "SELECT id, project_id, event_id, issue_id, title, body, email, name, received_at \
         FROM user_reports WHERE project_id = $1 AND issue_id = $2 \
         ORDER BY received_at DESC LIMIT 100",
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let out: Vec<UserReportRow> = rows
        .into_iter()
        .map(|(id, project_id, event_id, issue_id, title, body, email, name, received_at)| {
            UserReportRow {
                id,
                project_id,
                event_id,
                issue_id,
                title,
                body,
                email,
                name,
                received_at,
            }
        })
        .collect();
    Ok(Json(out).into_response())
}
