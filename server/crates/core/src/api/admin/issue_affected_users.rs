//! v2.4 — Issue Detail "Affected users" panel data source.
//!
//!   GET /admin/api/projects/{project_id}/issues/{issue_id}/affected-users
//!        ?days=7&limit=20
//!
//! Returns the top-N fingerprints touching this issue inside the
//! requested window, ordered by event count desc.
//!
//! The dashboard renders the result as a panel beneath the
//! issue's stack trace. Each row links into
//! `/main/<org>/users/<fingerprintHex>` so the operator can drill
//! into one user's full timeline (Phase 7 / find-user lens core
//! flow).
//!
//! Privacy contract is the same as identity_lookup: rows surface
//! the 64-char lowercase hex fingerprint + key_type, never the
//! raw identity. Operator clicks through to the existing
//! single-fingerprint detail page.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedUsersQuery {
    #[serde(default)]
    pub days: Option<u32>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedUsersResp {
    pub issue_id: Uuid,
    pub window_days: u32,
    pub total_distinct: i64,
    pub rows: Vec<AffectedUserRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AffectedUserRow {
    pub fingerprint_hex: String,
    pub key_type: String,
    pub event_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

pub async fn affected_users(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<AffectedUsersQuery>,
) -> Result<Json<AffectedUsersResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let days = q.days.unwrap_or(7).clamp(1, 90);
    let limit = q.limit.unwrap_or(20).clamp(1, 100);

    let window_gte = OffsetDateTime::now_utc() - time::Duration::days(days as i64);

    // Resolve the org's default scope so we filter to its
    // identity_fingerprints (the same scope ingest writes to).
    let scope_id: Option<Uuid> = sqlx::query_scalar(
        r#"
        SELECT s.id
        FROM projects p
        JOIN org_identity_scopes ois ON ois.org_id = p.org_id AND ois.is_default = true
        JOIN identity_scopes s ON s.id = ois.scope_id
        WHERE p.id = $1
        LIMIT 1
        "#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let Some(scope_id) = scope_id else {
        return Ok(Json(AffectedUsersResp {
            issue_id,
            window_days: days,
            total_distinct: 0,
            rows: Vec::new(),
        }));
    };

    // Top-N + total distinct in two cheap queries against the
    // (scope_id, received_at) index that 0066 added.
    let rows: Vec<AffectedUserRow> = sqlx::query_as::<_, AffectedUserRow>(
        r#"
        SELECT
          encode(f.fingerprint, 'hex')        AS fingerprint_hex,
          f.key_type                          AS key_type,
          COUNT(*)::BIGINT                    AS event_count,
          MAX(e.received_at)                  AS last_seen
        FROM events e
        JOIN identity_fingerprints f ON f.event_id = e.id
        WHERE e.project_id = $1
          AND e.issue_id   = $2
          AND f.scope_id   = $3
          AND e.received_at >= $4
        GROUP BY f.fingerprint, f.key_type
        ORDER BY event_count DESC, last_seen DESC
        LIMIT $5
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .bind(scope_id)
    .bind(window_gte)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let total_distinct: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(DISTINCT (f.fingerprint, f.key_type))::BIGINT
        FROM events e
        JOIN identity_fingerprints f ON f.event_id = e.id
        WHERE e.project_id = $1
          AND e.issue_id   = $2
          AND f.scope_id   = $3
          AND e.received_at >= $4
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .bind(scope_id)
    .bind(window_gte)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(AffectedUsersResp {
        issue_id,
        window_days: days,
        total_distinct,
        rows,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_defaults() {
        let q: AffectedUsersQuery = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(q.days, None);
        assert_eq!(q.limit, None);
    }

    #[test]
    fn query_parses_camel() {
        let q: AffectedUsersQuery =
            serde_json::from_value(serde_json::json!({"days": 30, "limit": 5})).unwrap();
        assert_eq!(q.days, Some(30));
        assert_eq!(q.limit, Some(5));
    }
}
