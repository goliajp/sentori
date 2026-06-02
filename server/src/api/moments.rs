// v0.9.0 #6 — moments admin endpoints. Backed by existing spans table
// where op = 'sentori.moment'.
//
// GET /admin/api/projects/{id}/moments              — distinct names + agg
// GET /admin/api/projects/{id}/moments/{name}       — recent samples for a name

use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MomentName {
    pub name: String,
    pub count: i64,
    pub abandoned: i64,
    pub failed: i64,
    pub p50_ms: i64,
    pub p95_ms: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

/// `GET /admin/api/projects/{project_id}/moments`
pub async fn list_for_project(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<MomentName>::new()).into_response());
    };

    // Spans table stores moments as op = 'sentori.moment'. We aggregate
    // per `moment.name` tag (jsonb path inside tags).
    let rows: Vec<(String, i64, i64, i64, i64, i64, OffsetDateTime)> = sqlx::query_as(
        r#"
        SELECT
            COALESCE(s.tags->>'moment.name', s.name)            AS name,
            COUNT(*)::BIGINT                                    AS count,
            COUNT(*) FILTER (WHERE s.tags->>'moment.abandoned' = 'true')::BIGINT AS abandoned,
            COUNT(*) FILTER (WHERE s.status = 'error')::BIGINT  AS failed,
            COALESCE(PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY s.duration_ms)::BIGINT, 0) AS p50_ms,
            COALESCE(PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY s.duration_ms)::BIGINT, 0) AS p95_ms,
            MAX(s.started_at)                                   AS last_seen
        FROM spans s
        WHERE s.project_id = $1
          AND s.op = 'sentori.moment'
          AND s.started_at >= now() - interval '7 days'
        GROUP BY name
        ORDER BY last_seen DESC
        LIMIT 200
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let out: Vec<MomentName> = rows
        .into_iter()
        .map(
            |(name, count, abandoned, failed, p50_ms, p95_ms, last_seen)| MomentName {
                name,
                count,
                abandoned,
                failed,
                p50_ms,
                p95_ms,
                last_seen,
            },
        )
        .collect();
    Ok(Json(out).into_response())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MomentSample {
    pub id: Uuid,
    pub name: String,
    pub status: String,
    pub abandoned: bool,
    pub duration_ms: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
}

/// `GET /admin/api/projects/{project_id}/moments/{name}`
pub async fn list_samples(
    State(state): State<AppState>,
    Path((project_id, name)): Path<(Uuid, String)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<MomentSample>::new()).into_response());
    };

    let rows: Vec<(Uuid, String, String, bool, i64, OffsetDateTime)> = sqlx::query_as(
        r#"
        SELECT
            s.id,
            COALESCE(s.tags->>'moment.name', s.name) AS name,
            s.status,
            (s.tags->>'moment.abandoned' = 'true')   AS abandoned,
            s.duration_ms,
            s.started_at
        FROM spans s
        WHERE s.project_id = $1
          AND s.op = 'sentori.moment'
          AND COALESCE(s.tags->>'moment.name', s.name) = $2
          AND s.started_at >= now() - interval '7 days'
        ORDER BY s.started_at DESC
        LIMIT 200
        "#,
    )
    .bind(project_id)
    .bind(&name)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let out: Vec<MomentSample> = rows
        .into_iter()
        .map(
            |(id, name, status, abandoned, duration_ms, started_at)| MomentSample {
                id,
                name,
                status,
                abandoned,
                duration_ms,
                started_at,
            },
        )
        .collect();
    Ok(Json(out).into_response())
}
