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

/// PATCH /v1/projects/:project_id/issues/:issue_id
///
/// Body: `{ status?: "active" | "resolved" | "regressed" | "ignored",
///           resolved_in_release?: string }`
pub async fn patch(
    State(state): State<Arc<AppState>>,
    Path((_project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PatchBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    use sentori_event_pipeline::IssueStatus;
    use sentori_issue_store::IssuePatch;

    let status = match body.status.as_deref() {
        None => None,
        Some("active") => Some(IssueStatus::Active),
        Some("resolved") => Some(IssueStatus::Resolved),
        Some("regressed") => Some(IssueStatus::Regressed),
        Some("ignored") => Some(IssueStatus::Ignored),
        Some(other) => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("invalid status: {other}"),
            ));
        }
    };
    let patch = IssuePatch {
        status,
        assignee_user_id: None,
        priority: None,
        labels: None,
        resolved_in_release: body.resolved_in_release,
    };
    state
        .issues
        .patch(issue_id, patch, OffsetDateTime::now_utc())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if let Some(status_label) = body.status.as_deref() {
        crate::notify::notify_issue_watchers(
            &state.pool,
            issue_id,
            None,
            "issue_status",
            serde_json::json!({
                "issue_id": issue_id.to_string(),
                "status": status_label,
            }),
        )
        .await;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Default)]
pub struct PatchBody {
    pub status: Option<String>,
    pub resolved_in_release: Option<String>,
}

/// POST /v1/projects/:project_id/issues/_bulk_patch
/// Body: { ids: [uuid…], status?: "resolved" | ... }
pub async fn bulk_patch(
    State(state): State<Arc<AppState>>,
    Path(_project_id): Path<Uuid>,
    Json(body): Json<BulkPatchBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    use sentori_event_pipeline::IssueStatus;
    use sentori_issue_store::IssuePatch;

    let status = match body.status.as_deref() {
        None => None,
        Some("active") => Some(IssueStatus::Active),
        Some("resolved") => Some(IssueStatus::Resolved),
        Some("regressed") => Some(IssueStatus::Regressed),
        Some("ignored") => Some(IssueStatus::Ignored),
        Some(other) => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("invalid status: {other}"),
            ));
        }
    };
    let patch = IssuePatch {
        status,
        assignee_user_id: None,
        priority: None,
        labels: None,
        resolved_in_release: body.resolved_in_release,
    };
    let outcome = state
        .issues
        .bulk_patch(&body.ids, patch, OffsetDateTime::now_utc())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::json!({
        "updated": outcome.updated,
    })))
}

#[derive(Deserialize, Default)]
pub struct BulkPatchBody {
    pub ids: Vec<Uuid>,
    pub status: Option<String>,
    pub resolved_in_release: Option<String>,
}

/// GET /v1/projects/:project_id/issues/:issue_id
pub async fn get(
    State(state): State<Arc<AppState>>,
    Path((_project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT id, project_id, fingerprint, error_type, message_sample, kind, status, \
                event_count, first_seen, last_seen, last_release, last_environment, \
                regressed_at, regressed_in_release, resolved_at \
         FROM issues WHERE id = $1",
    )
    .bind(issue_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or((StatusCode::NOT_FOUND, "issue_not_found".to_string()))?;
    let _ = ProjectId::from_uuid;
    Ok(Json(serde_json::json!({
        "id": row.get::<Uuid, _>("id").to_string(),
        "project_id": row.get::<Uuid, _>("project_id").to_string(),
        "fingerprint": row.get::<String, _>("fingerprint"),
        "error_type": row.get::<String, _>("error_type"),
        "message_sample": row.try_get::<String, _>("message_sample").unwrap_or_default(),
        "kind": row.get::<String, _>("kind"),
        "status": row.get::<String, _>("status"),
        "event_count": row.get::<i64, _>("event_count"),
        "first_seen": row.get::<OffsetDateTime, _>("first_seen"),
        "last_seen": row.get::<OffsetDateTime, _>("last_seen"),
        "last_release": row.get::<String, _>("last_release"),
        "last_environment": row.get::<String, _>("last_environment"),
        "regressed_at": row.try_get::<Option<OffsetDateTime>, _>("regressed_at").ok().flatten(),
        "regressed_in_release": row.try_get::<Option<String>, _>("regressed_in_release").ok().flatten(),
        "resolved_at": row.try_get::<Option<OffsetDateTime>, _>("resolved_at").ok().flatten(),
    })))
}
