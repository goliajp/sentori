// v0.9.2 +S6 — admin endpoints for the Privacy module.
//
// GET /admin/api/projects/{id}/privacy/score?release=<r>
//     → { release, score: 0..100, total_events, leaking_events, leaks_by_kind, top_fields }
//
// GET /admin/api/projects/{id}/privacy/findings?release=<r>&limit=N
//     → recent findings list (paginated by seen_at DESC)

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreParams {
    pub release: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyScore {
    pub release: String,
    /// 0–100. Computed: max(0, 100 - leaks_per_event * 200 - distinct_paths * 5).
    pub score: i32,
    pub total_events: i64,
    pub leaking_events: i64,
    pub leaks_by_kind: BTreeMap<String, i64>,
    pub top_fields: Vec<TopField>,
    pub risk: String, // 'low' | 'medium' | 'high'
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopField {
    pub field_path: String,
    pub kind: String,
    pub count: i64,
}

pub async fn score(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(p): Query<ScoreParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<i32>::new()).into_response());
    };

    // Resolve "current release" when not given — use the most recent
    // release the project ingested in the last 24h.
    let release = match p.release {
        Some(r) => r,
        None => {
            sqlx::query_scalar::<_, String>(
                "SELECT release FROM events WHERE project_id = $1 \
                 AND received_at >= now() - interval '24 hours' \
                 GROUP BY release ORDER BY MAX(received_at) DESC LIMIT 1",
            )
            .bind(project_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            .unwrap_or_else(|| "(none)".to_string())
        }
    };

    let total_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::BIGINT FROM events \
         WHERE project_id = $1 AND release = $2 \
         AND received_at >= now() - interval '7 days'",
    )
    .bind(project_id)
    .bind(&release)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let leaking_events: i64 = sqlx::query_scalar(
        "SELECT COUNT(DISTINCT event_id)::BIGINT FROM pii_findings \
         WHERE project_id = $1 AND release = $2",
    )
    .bind(project_id)
    .bind(&release)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let kind_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT pattern_kind, COUNT(*)::BIGINT FROM pii_findings \
         WHERE project_id = $1 AND release = $2 GROUP BY pattern_kind",
    )
    .bind(project_id)
    .bind(&release)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let leaks_by_kind: BTreeMap<String, i64> = kind_rows.into_iter().collect();

    let top_rows: Vec<(String, String, i64)> = sqlx::query_as(
        "SELECT field_path, pattern_kind, COUNT(*)::BIGINT AS c FROM pii_findings \
         WHERE project_id = $1 AND release = $2 \
         GROUP BY field_path, pattern_kind ORDER BY c DESC LIMIT 12",
    )
    .bind(project_id)
    .bind(&release)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let top_fields: Vec<TopField> = top_rows
        .into_iter()
        .map(|(field_path, kind, count)| TopField {
            field_path,
            kind,
            count,
        })
        .collect();

    // Scoring heuristic.
    let leak_ratio = if total_events > 0 {
        leaking_events as f64 / total_events as f64
    } else {
        0.0
    };
    let distinct_paths = top_fields.len() as f64;
    let raw_score = 100.0 - (leak_ratio * 200.0) - (distinct_paths * 5.0);
    let score = raw_score.max(0.0).min(100.0).round() as i32;
    let risk = if score >= 80 {
        "low"
    } else if score >= 50 {
        "medium"
    } else {
        "high"
    }
    .to_string();

    Ok(Json(PrivacyScore {
        leaks_by_kind,
        leaking_events,
        release,
        risk,
        score,
        top_fields,
        total_events,
    })
    .into_response())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingsParams {
    pub release: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: Uuid,
    pub event_id: Uuid,
    pub release: String,
    pub field_path: String,
    pub pattern_kind: String,
    pub sample: String,
    #[serde(with = "time::serde::rfc3339")]
    pub seen_at: OffsetDateTime,
}

pub async fn findings(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(p): Query<FindingsParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<Finding>::new()).into_response());
    };
    let limit = p.limit.unwrap_or(200).clamp(1, 500);

    let rows: Vec<(
        Uuid,
        Uuid,
        String,
        String,
        String,
        String,
        OffsetDateTime,
    )> = match &p.release {
        Some(r) => sqlx::query_as(
            "SELECT id, event_id, release, field_path, pattern_kind, sample, seen_at \
             FROM pii_findings WHERE project_id = $1 AND release = $2 \
             ORDER BY seen_at DESC LIMIT $3",
        )
        .bind(project_id)
        .bind(r)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?,
        None => sqlx::query_as(
            "SELECT id, event_id, release, field_path, pattern_kind, sample, seen_at \
             FROM pii_findings WHERE project_id = $1 \
             ORDER BY seen_at DESC LIMIT $2",
        )
        .bind(project_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?,
    };

    let out: Vec<Finding> = rows
        .into_iter()
        .map(
            |(id, event_id, release, field_path, pattern_kind, sample, seen_at)| Finding {
                id,
                event_id,
                release,
                field_path,
                pattern_kind,
                sample,
                seen_at,
            },
        )
        .collect();
    Ok(Json(out).into_response())
}
