//! v2.2 — cross-release issue lineage endpoint.
//!
//! Post-2.1 fingerprint policy puts `release` IN the key, so the
//! same exception across two releases lives in two separate
//! `issues` rows. That gives clean per-release isolation but loses
//! the "did the bug I fixed come back?" signal Sentry's regression
//! flip used to surface.
//!
//! This endpoint answers exactly that question without merging the
//! rows: for the issue at hand, find other issues in the same
//! project with the same `error_type` (and ideally a similar
//! normalised message) but a different `last_release`. The
//! dashboard renders a small "Related across releases" panel using
//! the returned rows — the operator sees "this look like resolved
//! IssueX@5.3.0?" inline, without the system having to make that
//! call automatically.
//!
//! v2.2 keeping the matching simple: error_type + project + not-
//! self + different last_release. The message similarity refinement
//! ("normalize and compare") can layer on if false positives turn
//! out to be a problem.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::Serialize;
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RelatedIssue {
    pub id: Uuid,
    pub error_type: String,
    pub message_sample: String,
    pub last_release: String,
    pub status: String,
    pub event_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub resolved_at: Option<OffsetDateTime>,
    pub resolved_in_release: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatedResp {
    pub source_issue_id: Uuid,
    pub error_type: String,
    pub last_release: String,
    pub related: Vec<RelatedIssue>,
}

pub async fn related_across_releases(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<RelatedResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    // 1. Get this issue's identity fields.
    let (error_type, last_release): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT error_type, last_release FROM issues \
         WHERE id = $1 AND project_id = $2",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .ok_or(AppError::NotFound)?;

    let error_type = error_type.unwrap_or_default();
    let last_release = last_release.unwrap_or_default();

    // Empty error_type would match every untyped issue — skip the
    // lookup entirely. Returns an empty `related` list.
    if error_type.is_empty() {
        return Ok(Json(RelatedResp {
            source_issue_id: issue_id,
            error_type: String::new(),
            last_release,
            related: Vec::new(),
        }));
    }

    // 2. Pull candidate issues: same project, same error_type,
    // different last_release, not self. Cap at 20 — this panel is
    // a sidebar hint, not a full triage list.
    let related: Vec<RelatedIssue> = sqlx::query_as::<_, RelatedIssue>(
        r#"
        SELECT
          id,
          COALESCE(error_type, '')        AS error_type,
          COALESCE(message_sample, '')    AS message_sample,
          COALESCE(last_release, '')      AS last_release,
          status,
          event_count::BIGINT,
          first_seen,
          last_seen,
          resolved_at,
          resolved_in_release
        FROM issues
        WHERE project_id = $1
          AND id != $2
          AND error_type = $3
          AND COALESCE(last_release, '') != $4
        ORDER BY last_seen DESC
        LIMIT 20
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .bind(&error_type)
    .bind(&last_release)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(RelatedResp {
        source_issue_id: issue_id,
        error_type,
        last_release,
        related,
    }))
}
