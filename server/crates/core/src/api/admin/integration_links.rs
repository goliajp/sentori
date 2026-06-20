// v1.2 W7.a — list integration links for one issue.
//
// `GET /admin/api/projects/{project_id}/issues/{issue_id}/integration-links`
// → [{ integrationKind, externalId, externalUrl, externalTitle,
//      externalStatus, externalUpdatedAt, createdAt }]
//
// Dashboard renders these in the issue detail's "Linked issues"
// section so operators see Linear / GitHub / GitLab / Jira state at a
// glance without an extra round-trip to the external API.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationLinkRow {
    pub integration_kind: String,
    pub external_id: String,
    pub external_url: Option<String>,
    pub external_title: Option<String>,
    pub external_status: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub external_updated_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub async fn list_integration_links(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<IntegrationLinkRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    assert_issue(pool, project_id, issue_id).await?;
    let rows: Vec<IntegrationLinkRow> = sqlx::query_as(
        r#"
        SELECT integration_kind, external_id, external_url,
               external_title, external_status, external_updated_at,
               created_at
        FROM issue_integration_links
        WHERE issue_id = $1
        ORDER BY integration_kind, created_at
        "#,
    )
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("list integration links: {e}")))?;
    Ok(Json(rows))
}

async fn assert_issue(pool: &PgPool, project_id: Uuid, issue_id: Uuid) -> Result<(), AppError> {
    let exists: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM issues WHERE id = $1 AND project_id = $2",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }
    Ok(())
}
