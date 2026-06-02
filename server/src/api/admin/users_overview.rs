//! v2.4 — Users overview endpoint.
//!
//!   GET /admin/api/orgs/{slug}/users/overview?days=7&limit=50
//!
//! Powers the Users page default view. Aggregates over the org's
//! default identity scope on the (identity_fingerprints JOIN events)
//! pair — no raw identity ever returned, only fingerprint hex.
//!
//! Returns three blocks:
//!   - kpi: identifiedUsers / affectedUsers / crashFreeRatio (last N days)
//!   - top: most-affected fingerprints with primary release / OS
//!   - breakdown: fp counts per release + per key_type
//!
//! Privacy contract (same as identity_lookup):
//!   - No raw email/phone/sub crosses the wire either direction.
//!   - Fingerprint surfaces as 64-char lowercase hex to the UI.
//!   - "Org doesn't exist" returns the same shape as "org exists with
//!     zero data" — no existence leak.

use axum::{
    extract::{Path, Query, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

const DEFAULT_DAYS: i32 = 7;
const MAX_DAYS: i32 = 90;
const DEFAULT_LIMIT: i32 = 50;
const MAX_LIMIT: i32 = 200;

#[derive(Debug, Deserialize)]
pub struct OverviewQuery {
    pub days: Option<i32>,
    pub limit: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverviewResp {
    pub scope_id: Uuid,
    pub window_days: i32,
    pub kpi: Kpi,
    pub top: Vec<TopRow>,
    pub breakdown: Breakdown,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Kpi {
    pub identified_users: i64,
    pub affected_users: i64,
    pub crash_free_ratio: f64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TopRow {
    pub fingerprint_hex: String,
    pub key_type: String,
    pub event_count: i64,
    pub issue_count: i64,
    pub primary_release: Option<String>,
    pub primary_os: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    pub by_release: Vec<BreakdownRow>,
    pub by_key_type: Vec<BreakdownRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRow {
    pub label: String,
    pub fingerprint_count: i64,
}

pub async fn overview(
    State(state): State<AppState>,
    Path(org_slug): Path<String>,
    Query(q): Query<OverviewQuery>,
) -> Result<Json<OverviewResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    let days = q.days.unwrap_or(DEFAULT_DAYS).clamp(1, MAX_DAYS);
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // Resolve org's default scope. Same "no existence leak" shape as
    // identity_lookup: missing org → empty payload, not 404.
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
        return Ok(Json(empty_response(days)));
    };

    // KPI block — three numbers from one CTE over the window.
    //
    //   identified  = distinct fingerprints seen in window
    //   affected    = distinct fingerprints with at least one error/anr/nearCrash
    //   crash_free  = 1 - affected/identified (0 when identified=0)
    let kpi_row: (i64, i64) = sqlx::query_as(
        r#"
        WITH wf AS (
            SELECT f.fingerprint,
                   bool_or(e.error_type IS NOT NULL AND e.error_type <> '') AS had_error
            FROM identity_fingerprints f
            JOIN events e ON e.id = f.event_id
            WHERE f.scope_id = $1
              AND e.received_at >= now() - ($2::int || ' days')::interval
            GROUP BY f.fingerprint
        )
        SELECT
          COUNT(*)::BIGINT                                  AS identified,
          COUNT(*) FILTER (WHERE had_error)::BIGINT         AS affected
        FROM wf
        "#,
    )
    .bind(scope_id)
    .bind(days)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let identified = kpi_row.0;
    let affected = kpi_row.1;
    let crash_free_ratio = if identified > 0 {
        1.0 - (affected as f64 / identified as f64)
    } else {
        1.0
    };

    // Top-N most affected fingerprints. "Primary" release / OS = MODE
    // per fingerprint. encode(fingerprint, 'hex') makes the UI key
    // human-pasteable. Window-bounded so the table stays light.
    let top: Vec<TopRow> = sqlx::query_as::<_, TopRow>(
        r#"
        SELECT
          encode(f.fingerprint, 'hex')                              AS fingerprint_hex,
          MIN(f.key_type)                                            AS key_type,
          COUNT(*)::BIGINT                                           AS event_count,
          COUNT(DISTINCT e.issue_id)::BIGINT                         AS issue_count,
          MODE() WITHIN GROUP (ORDER BY e.release)                   AS primary_release,
          MODE() WITHIN GROUP (ORDER BY (e.payload->'device'->>'os')) AS primary_os,
          MIN(e.received_at)                                         AS first_seen,
          MAX(e.received_at)                                         AS last_seen
        FROM identity_fingerprints f
        JOIN events e ON e.id = f.event_id
        WHERE f.scope_id = $1
          AND e.received_at >= now() - ($2::int || ' days')::interval
        GROUP BY f.fingerprint
        ORDER BY event_count DESC
        LIMIT $3
        "#,
    )
    .bind(scope_id)
    .bind(days)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Per-release breakdown — distinct fingerprint count per release.
    let by_release: Vec<BreakdownRow> = sqlx::query_as::<_, BreakdownRow>(
        r#"
        SELECT
          e.release                                AS label,
          COUNT(DISTINCT f.fingerprint)::BIGINT    AS fingerprint_count
        FROM identity_fingerprints f
        JOIN events e ON e.id = f.event_id
        WHERE f.scope_id = $1
          AND e.received_at >= now() - ($2::int || ' days')::interval
        GROUP BY e.release
        ORDER BY fingerprint_count DESC
        LIMIT 20
        "#,
    )
    .bind(scope_id)
    .bind(days)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Per-key-type breakdown — how many distinct fingerprints by
    // which identity flavour (email vs googleSub vs phone ...).
    let by_key_type: Vec<BreakdownRow> = sqlx::query_as::<_, BreakdownRow>(
        r#"
        SELECT
          f.key_type                               AS label,
          COUNT(DISTINCT f.fingerprint)::BIGINT    AS fingerprint_count
        FROM identity_fingerprints f
        JOIN events e ON e.id = f.event_id
        WHERE f.scope_id = $1
          AND e.received_at >= now() - ($2::int || ' days')::interval
        GROUP BY f.key_type
        ORDER BY fingerprint_count DESC
        "#,
    )
    .bind(scope_id)
    .bind(days)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(OverviewResp {
        scope_id,
        window_days: days,
        kpi: Kpi {
            identified_users: identified,
            affected_users: affected,
            crash_free_ratio,
        },
        top,
        breakdown: Breakdown {
            by_release,
            by_key_type,
        },
    }))
}

fn empty_response(days: i32) -> OverviewResp {
    OverviewResp {
        scope_id: Uuid::nil(),
        window_days: days,
        kpi: Kpi {
            identified_users: 0,
            affected_users: 0,
            crash_free_ratio: 1.0,
        },
        top: Vec::new(),
        breakdown: Breakdown {
            by_release: Vec::new(),
            by_key_type: Vec::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_response_shape() {
        let r = empty_response(7);
        assert_eq!(r.window_days, 7);
        assert_eq!(r.kpi.identified_users, 0);
        assert_eq!(r.kpi.affected_users, 0);
        assert!((r.kpi.crash_free_ratio - 1.0).abs() < f64::EPSILON);
        assert!(r.top.is_empty());
        assert!(r.breakdown.by_release.is_empty());
        assert!(r.breakdown.by_key_type.is_empty());
    }

    #[test]
    fn query_clamps_days() {
        let q = OverviewQuery {
            days: Some(999),
            limit: None,
        };
        let clamped = q.days.unwrap_or(DEFAULT_DAYS).clamp(1, MAX_DAYS);
        assert_eq!(clamped, MAX_DAYS);
    }

    #[test]
    fn query_clamps_limit() {
        let q = OverviewQuery {
            days: None,
            limit: Some(0),
        };
        let clamped = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
        assert_eq!(clamped, 1);
    }
}
