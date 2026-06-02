//! v2.3 — cross-project user lookup endpoint.
//!
//!   POST /admin/api/orgs/{slug}/users/lookup
//!   body: { keyType: "email", clientHash: "<64-char lowercase hex>" }
//!
//! Org-scoped (resolves the org's default identity scope internally
//! so the dashboard doesn't need to track scope ids). For LLM
//! agents addressing scopes directly, a parallel
//! `/identity-scopes/{id}/lookup` may land in v2.4.
//!
//! Returns:
//!   { hits: [{ projectId, eventCount, firstSeen, lastSeen, issueCount }],
//!     totalEvents, scopeId }
//!
//! Privacy contract (see docs/design/sdk-v2.3-redesign.md §5):
//!
//!   - Operator's dashboard hashes the raw value (email / phone /
//!     googleSub / ...) client-side via crypto.subtle. Body
//!     carries ONLY the hash, never the raw value.
//!   - Server takes the client_hash + scope.salt, computes the same
//!     stored fingerprint as ingest time, JOINs against
//!     identity_fingerprints.
//!   - "No match" and "match found with empty result" return the
//!     SAME shape to avoid leaking existence.
//!   - No logging of clientHash values (already hashed but
//!     defence-in-depth — don't accumulate them in log files).
//!
//! Rate limit: 60/min per session (per the design doc). Implemented
//! via the existing rate-limit middleware on admin routes; no
//! per-endpoint extra cap here yet (todo: tighter limit).

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupReq {
    pub key_type: String,
    pub client_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupResp {
    pub scope_id: Uuid,
    pub key_type: String,
    pub total_events: i64,
    pub hits: Vec<ProjectHit>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHit {
    pub project_id: Uuid,
    pub event_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
    pub issue_count: i64,
}

pub async fn lookup(
    State(state): State<AppState>,
    Path(org_slug): Path<String>,
    Json(req): Json<LookupReq>,
) -> Result<Json<LookupResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    // Validate the client_hash shape — same rule as the ingest path
    // uses. Reject malformed input quietly with 400 (don't echo the
    // value back).
    if !crate::identity::is_valid_client_hash(&req.client_hash) {
        return Err(AppError::BadRequest(
            "clientHash must be 64-char lowercase hex sha256".into(),
        ));
    }
    if req.key_type.is_empty() || req.key_type.len() > 64 {
        return Err(AppError::BadRequest(
            "keyType must be non-empty and <= 64 chars".into(),
        ));
    }

    // Resolve the org's default identity scope + its salt in one
    // query.
    let row: Option<(Uuid, Vec<u8>)> = sqlx::query_as(
        r#"
        SELECT s.id, s.salt
        FROM orgs o
        JOIN org_identity_scopes ois ON ois.org_id = o.id AND ois.is_default = true
        JOIN identity_scopes s ON s.id = ois.scope_id
        WHERE o.slug = $1
        LIMIT 1
        "#,
    )
    .bind(&org_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let Some((scope_id, salt)) = row else {
        // Same shape as "no match" — don't leak whether the org
        // exists or not.
        return Ok(Json(LookupResp {
            scope_id: Uuid::nil(),
            key_type: req.key_type,
            total_events: 0,
            hits: Vec::new(),
        }));
    };

    let stored_fp = crate::identity::compute_fingerprint(&salt, &req.key_type, &req.client_hash);

    // Aggregate per project: how many events touched this fingerprint,
    // first/last seen, distinct issue count.
    let hits: Vec<ProjectHit> = sqlx::query_as::<_, ProjectHit>(
        r#"
        SELECT
          e.project_id,
          COUNT(*)::BIGINT                          AS event_count,
          MIN(e.received_at)                        AS first_seen,
          MAX(e.received_at)                        AS last_seen,
          COUNT(DISTINCT e.issue_id)::BIGINT        AS issue_count
        FROM identity_fingerprints f
        JOIN events e ON e.id = f.event_id
        WHERE f.scope_id = $1
          AND f.key_type = $2
          AND f.fingerprint = $3
        GROUP BY e.project_id
        ORDER BY MAX(e.received_at) DESC
        "#,
    )
    .bind(scope_id)
    .bind(&req.key_type)
    .bind(&stored_fp)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let total_events: i64 = hits.iter().map(|h| h.event_count).sum();

    Ok(Json(LookupResp {
        scope_id,
        key_type: req.key_type,
        total_events,
        hits,
    }))
}
