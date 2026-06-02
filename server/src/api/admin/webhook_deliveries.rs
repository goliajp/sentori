// v1.4 W22 — webhook delivery list + manual retry.
//
// The retry queue (server/src/webhook_dispatch.rs) marches automatically:
// [60s, 5m, 30m, 2h, 12h, 24h] across up to 6 attempts before
// marking a delivery `failed`. Until v1.4 W22 there was no
// dashboard surface to see what's pending / failed and no way for
// an operator to kick a manual retry — they had to wait for the
// next scheduled attempt or poke the DB directly.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryRow {
    pub id: Uuid,
    pub rule_id: Uuid,
    pub rule_name: Option<String>,
    pub project_id: Option<Uuid>,
    pub target_url: String,
    pub status: String,
    pub attempt: i32,
    pub last_status: Option<i32>,
    pub last_error: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub next_attempt_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub delivered_at: Option<OffsetDateTime>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    /// Filter by status. Pass 'any' (or unset) for everything.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// `GET /admin/api/webhook-deliveries?status=pending|failed|delivered|any&limit=`
pub async fn list_deliveries(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<WebhookDeliveryRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => Some(id),
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => None,
    };
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let status_filter: Option<String> = match q.status.as_deref() {
        Some("any") | Some("") | None => None,
        Some(s) => Some(s.to_string()),
    };

    // Scope to alert_rules accessible to the caller: rules belong to
    // an org via alert_rules.project_id → projects.org_id. For users,
    // restrict to orgs they're members of. Legacy admin / dev token
    // see everything.
    let rows: Vec<WebhookDeliveryRow> = if let Some(uid) = user_id {
        sqlx::query_as(
            r#"
            SELECT wd.id, wd.rule_id, ar.name AS rule_name, ar.project_id,
                   wd.target_url, wd.status, wd.attempt,
                   wd.last_status, wd.last_error,
                   wd.next_attempt_at, wd.created_at, wd.delivered_at
            FROM webhook_deliveries wd
            JOIN alert_rules ar ON ar.id = wd.rule_id
            JOIN projects p ON p.id = ar.project_id
            JOIN memberships m ON m.org_id = p.org_id
            WHERE m.user_id = $1
              AND ($2::TEXT IS NULL OR wd.status = $2)
            ORDER BY wd.created_at DESC
            LIMIT $3
            "#,
        )
        .bind(uid)
        .bind(status_filter)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list deliveries: {e}")))?
    } else {
        sqlx::query_as(
            r#"
            SELECT wd.id, wd.rule_id, ar.name AS rule_name, ar.project_id,
                   wd.target_url, wd.status, wd.attempt,
                   wd.last_status, wd.last_error,
                   wd.next_attempt_at, wd.created_at, wd.delivered_at
            FROM webhook_deliveries wd
            JOIN alert_rules ar ON ar.id = wd.rule_id
            WHERE ($1::TEXT IS NULL OR wd.status = $1)
            ORDER BY wd.created_at DESC
            LIMIT $2
            "#,
        )
        .bind(status_filter)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list deliveries: {e}")))?
    };
    Ok(Json(rows))
}

/// `POST /admin/api/webhook-deliveries/{id}/retry` — reset the row
/// to pending + next_attempt_at = now() so the dispatcher picks it
/// up on the next tick.
pub async fn retry_delivery(
    State(state): State<AppState>,
    Extension(_caller): Extension<AdminCaller>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let res = sqlx::query(
        "UPDATE webhook_deliveries \
            SET status = 'pending', next_attempt_at = now(), \
                last_error = NULL \
         WHERE id = $1 AND status IN ('pending', 'failed')",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("retry: {e}")))?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Helper for the dispatcher — left here so the admin endpoint can
/// share schema knowledge with the worker. Not exposed publicly.
#[allow(dead_code)]
async fn _typecheck_only(_pool: &PgPool) {}
