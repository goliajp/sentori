// v0.9.4 #1 — Mobile Vitals admin endpoints.
//
// All vitals ride along the existing `spans` table:
//   • op = 'sentori.cold_start'       → cold start (one per launch)
//   • op = 'react.navigation'         → TTID + dwell + slow/frozen frame
//                                       tags per route
//   • op = 'react.navigation.ttfd'    → user-marked TTFD per route
//
// Endpoints aggregate over the last 7 days, grouped per release.
//
//   GET /admin/api/projects/{id}/vitals?release=<r>
//       → { release, coldStart, perRoute }
//   GET /admin/api/projects/{id}/vitals/releases
//       → distinct release list ordered by latest activity

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VitalsParams {
    pub release: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VitalsReport {
    pub release: String,
    pub cold_start: ColdStart,
    pub per_route: Vec<RouteVitals>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdStart {
    pub samples: i64,
    pub p50_ms: i64,
    pub p95_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteVitals {
    pub route: String,
    pub navigations: i64,
    pub ttid_p50_ms: i64,
    pub ttid_p95_ms: i64,
    pub ttfd_samples: i64,
    pub ttfd_p50_ms: i64,
    pub ttfd_p95_ms: i64,
    pub total_slow_frames: i64,
    pub total_frozen_frames: i64,
}

pub async fn report(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(p): Query<VitalsParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(serde_json::json!({ "error": "db unavailable" })).into_response());
    };

    let release = match p.release {
        Some(r) => r,
        None => sqlx::query_scalar::<_, String>(
            "SELECT release FROM events WHERE project_id = $1 \
             AND received_at >= now() - interval '24 hours' \
             GROUP BY release ORDER BY MAX(received_at) DESC LIMIT 1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .unwrap_or_else(|| "(none)".to_string()),
    };

    let cold: (i64, i64, i64) = sqlx::query_as(
        "SELECT COUNT(*)::BIGINT, \
                COALESCE(PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY duration_ms)::BIGINT, 0), \
                COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration_ms)::BIGINT, 0) \
         FROM spans \
         WHERE project_id = $1 AND op = 'sentori.cold_start' \
         AND started_at >= now() - interval '7 days'",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let route_rows: Vec<(String, i64, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT COALESCE(tags->>'nav.to', name)               AS route, \
                COUNT(*)::BIGINT                              AS navigations, \
                COALESCE(PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY duration_ms)::BIGINT, 0) AS ttid_p50, \
                COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration_ms)::BIGINT, 0) AS ttid_p95, \
                COALESCE(SUM(NULLIF(tags->>'vital.slow_frames', '')::BIGINT), 0)   AS slow, \
                COALESCE(SUM(NULLIF(tags->>'vital.frozen_frames', '')::BIGINT), 0) AS frozen \
         FROM spans \
         WHERE project_id = $1 AND op = 'react.navigation' \
         AND started_at >= now() - interval '7 days' \
         GROUP BY route \
         ORDER BY navigations DESC LIMIT 50",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // TTFD aggregation by route — same group key.
    let ttfd_rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(
        "SELECT name AS route, COUNT(*)::BIGINT AS samples, \
                COALESCE(PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY duration_ms)::BIGINT, 0) AS p50, \
                COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration_ms)::BIGINT, 0) AS p95 \
         FROM spans \
         WHERE project_id = $1 AND op = 'react.navigation.ttfd' \
         AND started_at >= now() - interval '7 days' \
         GROUP BY name",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let ttfd_map: std::collections::HashMap<String, (i64, i64, i64)> = ttfd_rows
        .into_iter()
        .map(|(r, n, p50, p95)| (r, (n, p50, p95)))
        .collect();

    let per_route: Vec<RouteVitals> = route_rows
        .into_iter()
        .map(|(route, navigations, ttid_p50, ttid_p95, slow, frozen)| {
            let (ttfd_n, ttfd_p50, ttfd_p95) = ttfd_map.get(&route).copied().unwrap_or((0, 0, 0));
            RouteVitals {
                route,
                navigations,
                ttid_p50_ms: ttid_p50,
                ttid_p95_ms: ttid_p95,
                ttfd_samples: ttfd_n,
                ttfd_p50_ms: ttfd_p50,
                ttfd_p95_ms: ttfd_p95,
                total_slow_frames: slow,
                total_frozen_frames: frozen,
            }
        })
        .collect();

    Ok(Json(VitalsReport {
        cold_start: ColdStart {
            samples: cold.0,
            p50_ms: cold.1,
            p95_ms: cold.2,
        },
        per_route,
        release,
    })
    .into_response())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRow {
    pub release: String,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
    pub event_count: i64,
}

pub async fn list_releases(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<ReleaseRow>::new()).into_response());
    };
    let rows: Vec<(String, OffsetDateTime, i64)> = sqlx::query_as(
        "SELECT release, MAX(received_at), COUNT(*)::BIGINT \
         FROM events WHERE project_id = $1 \
         AND received_at >= now() - interval '14 days' \
         GROUP BY release ORDER BY MAX(received_at) DESC LIMIT 50",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let out: Vec<ReleaseRow> = rows
        .into_iter()
        .map(|(release, last_seen, event_count)| ReleaseRow {
            release,
            last_seen,
            event_count,
        })
        .collect();
    Ok(Json(out).into_response())
}
