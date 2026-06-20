// v0.8.3 — custom metrics ingest + admin list.
//
// Ingest:
//   POST /v1/metrics:batch    (ingest token; same boundary as /v1/events)
//
// Admin (dashboard):
//   GET /admin/api/projects/{id}/metrics?name=<n>&since=<rfc3339>
//   GET /admin/api/projects/{id}/metric-names
//
// Up to 500 points per batch. Each point: `{ name, value, tags?, ts? }`.
// `ts` defaults to ingest time when absent; clients running offline
// can pass their own wall-clock and the server stores both `ts` and
// `received_at`.

use std::collections::BTreeMap;

use axum::{
    extract::{Extension, Json, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;
use validator::Validate;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::error::AppError;
use crate::recent::AppState;

const MAX_BATCH: usize = 500;

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct MetricInput {
    #[validate(length(min = 1, max = 200))]
    pub name: String,
    pub value: f64,
    /// Optional wall-clock for the point. Defaults to server `now()`.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub ts: Option<OffsetDateTime>,
    /// Free-form short labels. Caller-defined; server doesn't
    /// canonicalise. Cap at ~20 kv pairs to keep the jsonb small.
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub metrics: Vec<MetricInput>,
}

pub async fn ingest_batch(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(req): Json<BatchRequest>,
) -> Result<Response, AppError> {
    if req.metrics.len() > MAX_BATCH {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let project_id = caller_project_id(&caller, &state);
    let Some(pool) = &state.db else {
        return Ok(StatusCode::ACCEPTED.into_response());
    };

    let mut accepted = 0u32;
    for m in &req.metrics {
        if let Err(e) = m.validate() {
            tracing::debug!(error = ?e, "metric rejected (validation)");
            continue;
        }
        if m.tags.len() > 20 {
            tracing::debug!("metric rejected (too many tags)");
            continue;
        }
        let id = Uuid::now_v7();
        let ts = m.ts.unwrap_or_else(OffsetDateTime::now_utc);
        let tags_json =
            serde_json::to_value(&m.tags).unwrap_or(serde_json::Value::Object(Default::default()));
        let r = sqlx::query(
            "INSERT INTO metrics (id, project_id, name, value, tags, ts) \
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(id)
        .bind(project_id)
        .bind(&m.name)
        .bind(m.value)
        .bind(&tags_json)
        .bind(ts)
        .execute(pool)
        .await;
        if let Err(e) = r {
            tracing::error!(error = %e, "metric insert failed");
            continue;
        }
        accepted += 1;
    }
    tracing::info!(%project_id, accepted, "metric batch accepted");
    Ok(StatusCode::ACCEPTED.into_response())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRow {
    pub id: Uuid,
    pub name: String,
    pub value: f64,
    pub tags: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    pub ts: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    pub name: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub since: Option<OffsetDateTime>,
    pub limit: Option<i64>,
    /// v2.0 W3 — when set, return only metric points whose
    /// `tags.span_id` equals this. Drives the dashboard span detail
    /// "related metrics" row — see `docs/roadmap/v2.0.md` W3
    /// acceptance + `recordMetric(name, value, tags?, { parent })`
    /// in the SDK.
    pub span_id: Option<String>,
}

pub async fn list_for_project(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<ListParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<MetricRow>::new()).into_response());
    };
    let limit = params.limit.unwrap_or(1000).clamp(1, 5000);
    let since = params.since.unwrap_or_else(|| {
        OffsetDateTime::now_utc() - time::Duration::hours(24)
    });

    let rows: Vec<(Uuid, String, f64, serde_json::Value, OffsetDateTime)> = match (&params.name, &params.span_id) {
        (Some(name), Some(span_id)) => sqlx::query_as(
            "SELECT id, name, value, tags, ts FROM metrics \
             WHERE project_id = $1 AND name = $2 AND ts >= $3 \
             AND tags->>'span_id' = $4 \
             ORDER BY ts DESC LIMIT $5",
        )
        .bind(project_id)
        .bind(name)
        .bind(since)
        .bind(span_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?,
        (Some(name), None) => sqlx::query_as(
            "SELECT id, name, value, tags, ts FROM metrics \
             WHERE project_id = $1 AND name = $2 AND ts >= $3 \
             ORDER BY ts DESC LIMIT $4",
        )
        .bind(project_id)
        .bind(name)
        .bind(since)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?,
        (None, Some(span_id)) => sqlx::query_as(
            "SELECT id, name, value, tags, ts FROM metrics \
             WHERE project_id = $1 AND ts >= $2 \
             AND tags->>'span_id' = $3 \
             ORDER BY ts DESC LIMIT $4",
        )
        .bind(project_id)
        .bind(since)
        .bind(span_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?,
        (None, None) => sqlx::query_as(
            "SELECT id, name, value, tags, ts FROM metrics \
             WHERE project_id = $1 AND ts >= $2 \
             ORDER BY ts DESC LIMIT $3",
        )
        .bind(project_id)
        .bind(since)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?,
    };
    let out: Vec<MetricRow> = rows
        .into_iter()
        .map(|(id, name, value, tags, ts)| MetricRow {
            id,
            name,
            value,
            tags,
            ts,
        })
        .collect();
    Ok(Json(out).into_response())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NameSummary {
    pub name: String,
    pub count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

/// `GET /admin/api/projects/{project_id}/metric-names` — list distinct
/// metric names + their counts in the last 24 h. Drives the dashboard
/// sidebar / chart picker.
pub async fn list_metric_names(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<NameSummary>::new()).into_response());
    };
    let since = OffsetDateTime::now_utc() - time::Duration::hours(24);
    let rows: Vec<(String, i64, OffsetDateTime)> = sqlx::query_as(
        "SELECT name, COUNT(*)::bigint, MAX(ts) FROM metrics \
         WHERE project_id = $1 AND ts >= $2 \
         GROUP BY name ORDER BY MAX(ts) DESC LIMIT 200",
    )
    .bind(project_id)
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let out: Vec<NameSummary> = rows
        .into_iter()
        .map(|(name, count, last_seen)| NameSummary { name, count, last_seen })
        .collect();
    Ok(Json(out).into_response())
}
