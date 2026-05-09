use axum::{
    extract::{Extension, Json, Path, Query, State},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

/// Phase 13 sub-D: list projects visible to the caller.
/// - User session  → projects in any of the user's orgs.
/// - LegacyAdmin / DevToken → all projects (super-admin).
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub id: Uuid,
    pub name: String,
    pub org_id: Uuid,
    pub org_slug: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub async fn list_my_projects(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<Vec<ProjectRow>>, AppError> {
    let pool = state.db.as_ref().ok_or_else(|| AppError::DatabaseUnavailable)?;

    let rows: Vec<ProjectRow> = match caller {
        AdminCaller::User { id, .. } => sqlx::query_as(
            "SELECT p.id, p.name, p.org_id, o.slug AS org_slug, p.created_at \
             FROM projects p \
             JOIN orgs o ON o.id = p.org_id \
             JOIN memberships m ON m.org_id = p.org_id \
             WHERE m.user_id = $1 \
             ORDER BY p.created_at DESC",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list_my_projects: {e}")))?,
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => sqlx::query_as(
            "SELECT p.id, p.name, p.org_id, o.slug AS org_slug, p.created_at \
             FROM projects p \
             JOIN orgs o ON o.id = p.org_id \
             ORDER BY p.created_at DESC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list_my_projects: {e}")))?,
    };

    Ok(Json(rows))
}

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
    pub last_environment: Option<String>,
    pub last_release: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIssuesQuery {
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub limit: Option<i64>,
    /// Filter on `issues.last_environment` (denormalized from latest event).
    #[serde(default)]
    pub env: Option<String>,
    /// Filter on `issues.last_release` (denormalized from latest event).
    #[serde(default)]
    pub release: Option<String>,
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
               first_seen, last_seen, event_count,
               last_environment, last_release
        FROM issues
        WHERE project_id = $1
          AND status = $2
          AND ($3::TEXT IS NULL OR last_environment = $3)
          AND ($4::TEXT IS NULL OR last_release = $4)
        ORDER BY last_seen DESC
        LIMIT $5
        "#,
    )
    .bind(project_id)
    .bind(&q.status)
    .bind(q.env.as_deref())
    .bind(q.release.as_deref())
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(rows))
}

/// `GET /admin/api/projects/{project_id}/issues/{issue_id}/releases`
/// Distinct release names this issue has been seen on, sorted ascending.
pub async fn releases_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<String>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let rows: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT release
        FROM events
        WHERE project_id = $1 AND issue_id = $2
        ORDER BY release
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
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
               first_seen, last_seen, event_count,
               last_environment, last_release
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
    /// Default true. `?symbolicated=false` returns raw frames.
    #[serde(default)]
    pub symbolicated: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchIssueRequest {
    pub status: Option<String>,
}

const ALLOWED_STATUSES: &[&str] = &["active", "silenced", "closed"];

pub async fn patch_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PatchIssueRequest>,
) -> Result<Json<IssueRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    if let Some(status) = &body.status {
        if !ALLOWED_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Internal(format!(
                "invalid status '{status}'; allowed: {ALLOWED_STATUSES:?}"
            )));
        }
        sqlx::query(
            "UPDATE issues SET status = $1 WHERE project_id = $2 AND id = $3",
        )
        .bind(status)
        .bind(project_id)
        .bind(issue_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    let row: Option<IssueRow> = sqlx::query_as(
        r#"
        SELECT id, fingerprint, error_type, message_sample, status,
               first_seen, last_seen, event_count,
               last_environment, last_release
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

pub async fn list_events_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<ListEventsQuery>,
) -> Result<Json<Vec<EventRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let symbolicated = q.symbolicated.unwrap_or(true);

    let mut rows: Vec<EventRow> = sqlx::query_as(
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

    if symbolicated {
        for row in rows.iter_mut() {
            // Best-effort: leave raw frames in place on any failure.
            let _ = crate::symbolicate::symbolicate_payload(
                pool,
                &row.release,
                &mut row.payload,
            )
            .await;
        }
    }

    Ok(Json(rows))
}
