//! v2.4 — Users page drill-in: single-fingerprint detail.
//!
//!   GET /admin/api/orgs/{slug}/users/{fingerprintHex}?days=30
//!
//! Different shape from the POST /users/lookup variant: input is the
//! stored fingerprint hex (operator landed here from the most-affected
//! list or a deep-link), not a hashable raw value. We still take the
//! org slug to enforce scope (fingerprints are scope-bound) and round-
//! trip via identity_fingerprints same as lookup.
//!
//! Returns:
//!   - per-project hits (same as POST lookup)
//!   - hour-bucketed event timeline over the window
//!   - top issues touching this fingerprint (id, title, count, last_seen)
//!
//! Privacy contract: the path parameter is already the salted stored
//! fingerprint — operator can't supply anything more sensitive here.
//! "Org doesn't exist" / "fingerprint doesn't match anything" both
//! return the empty-shape response.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

const DEFAULT_DAYS: i32 = 30;
const MAX_DAYS: i32 = 365;

#[derive(Debug, Deserialize)]
pub struct DetailQuery {
    pub days: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailResp {
    pub scope_id: Uuid,
    pub fingerprint_hex: String,
    pub window_days: i32,
    pub total_events: i64,
    pub hits: Vec<ProjectHit>,
    pub timeline: Vec<TimelineBucket>,
    pub top_issues: Vec<TopIssue>,
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

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TimelineBucket {
    #[serde(with = "time::serde::rfc3339")]
    pub hour_bucket: OffsetDateTime,
    pub event_count: i64,
    pub error_count: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TopIssue {
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub title: String,
    pub event_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

pub async fn detail(
    State(state): State<AppState>,
    Path((org_slug, fingerprint_hex)): Path<(String, String)>,
    Query(q): Query<DetailQuery>,
) -> Result<Json<DetailResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    // Validate fingerprint shape: 64-char lowercase hex.
    if !is_valid_fingerprint_hex(&fingerprint_hex) {
        return Err(AppError::BadRequest(
            "fingerprintHex must be 64-char lowercase hex".into(),
        ));
    }
    let stored_fp = hex_decode(&fingerprint_hex)?;
    let days = q.days.unwrap_or(DEFAULT_DAYS).clamp(1, MAX_DAYS);

    // Resolve scope; empty-shape on miss (same as lookup / overview).
    let scope_row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        SELECT s.id
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

    let Some((scope_id,)) = scope_row else {
        return Ok(Json(empty_response(fingerprint_hex, days)));
    };

    // Per-project hits — same shape as POST lookup.
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
          AND f.fingerprint = $2
        GROUP BY e.project_id
        ORDER BY MAX(e.received_at) DESC
        "#,
    )
    .bind(scope_id)
    .bind(&stored_fp)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let total_events: i64 = hits.iter().map(|h| h.event_count).sum();

    // Hour-bucketed timeline within the requested window.
    let timeline: Vec<TimelineBucket> = sqlx::query_as::<_, TimelineBucket>(
        r#"
        SELECT
          date_trunc('hour', e.received_at)                AS hour_bucket,
          COUNT(*)::BIGINT                                  AS event_count,
          COUNT(*) FILTER (
            WHERE e.error_type IS NOT NULL AND e.error_type <> ''
          )::BIGINT                                         AS error_count
        FROM identity_fingerprints f
        JOIN events e ON e.id = f.event_id
        WHERE f.scope_id = $1
          AND f.fingerprint = $2
          AND e.received_at >= now() - ($3::int || ' days')::interval
        GROUP BY date_trunc('hour', e.received_at)
        ORDER BY hour_bucket ASC
        "#,
    )
    .bind(scope_id)
    .bind(&stored_fp)
    .bind(days)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Top issues this fingerprint touched.
    let top_issues: Vec<TopIssue> = sqlx::query_as::<_, TopIssue>(
        r#"
        SELECT
          i.id                                              AS issue_id,
          i.project_id                                      AS project_id,
          COALESCE(NULLIF(i.message_sample, ''), i.error_type, 'unknown') AS title,
          COUNT(e.id)::BIGINT                               AS event_count,
          MAX(e.received_at)                                AS last_seen
        FROM identity_fingerprints f
        JOIN events e ON e.id = f.event_id
        JOIN issues  i ON i.id = e.issue_id
        WHERE f.scope_id = $1
          AND f.fingerprint = $2
        GROUP BY i.id, i.project_id, i.message_sample, i.error_type
        ORDER BY MAX(e.received_at) DESC
        LIMIT 20
        "#,
    )
    .bind(scope_id)
    .bind(&stored_fp)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(DetailResp {
        scope_id,
        fingerprint_hex,
        window_days: days,
        total_events,
        hits,
        timeline,
        top_issues,
    }))
}

fn is_valid_fingerprint_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn hex_decode(s: &str) -> Result<Vec<u8>, AppError> {
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = hex_nibble(bytes[i])?;
        let lo = hex_nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Ok(out)
}

fn hex_nibble(b: u8) -> Result<u8, AppError> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        _ => Err(AppError::BadRequest("invalid hex char".into())),
    }
}

fn empty_response(fingerprint_hex: String, days: i32) -> DetailResp {
    DetailResp {
        scope_id: Uuid::nil(),
        fingerprint_hex,
        window_days: days,
        total_events: 0,
        hits: Vec::new(),
        timeline: Vec::new(),
        top_issues: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_hex_accepts_64_lowercase() {
        assert!(is_valid_fingerprint_hex(
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        ));
    }

    #[test]
    fn valid_hex_rejects_uppercase() {
        assert!(!is_valid_fingerprint_hex(
            "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        ));
    }

    #[test]
    fn valid_hex_rejects_short() {
        assert!(!is_valid_fingerprint_hex("abcd"));
    }

    #[test]
    fn hex_decode_roundtrip() {
        let s = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
        let bytes = hex_decode(s).unwrap();
        assert_eq!(bytes.len(), 32);
        assert_eq!(bytes[0], 0x00);
        assert_eq!(bytes[1], 0x11);
        assert_eq!(bytes[31], 0xff);
    }

    #[test]
    fn empty_response_carries_input() {
        let r = empty_response("dead".repeat(16), 7);
        assert_eq!(r.window_days, 7);
        assert_eq!(r.total_events, 0);
        assert!(r.hits.is_empty());
        assert!(r.timeline.is_empty());
        assert!(r.top_issues.is_empty());
    }
}
