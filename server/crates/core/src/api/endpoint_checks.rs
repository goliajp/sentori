// v2.1 W4 part 2 — admin CRUD for endpoint health checks.
//
//   POST   /admin/api/projects/{p}/endpoint-checks         — create
//   GET    /admin/api/projects/{p}/endpoint-checks         — list
//   GET    /admin/api/projects/{p}/endpoint-checks/{id}    — get one
//   PUT    /admin/api/projects/{p}/endpoint-checks/{id}    — update
//   DELETE /admin/api/projects/{p}/endpoint-checks/{id}    — delete
//
//   GET    /admin/api/projects/{p}/endpoint-checks/{id}/probes
//          ?from=…&to=…&limit=…                            — probe log
//
//   GET    /admin/api/projects/{p}/endpoint-checks/{id}/rollup
//          ?from=…&to=…                                    — _1h tier
//
// Reuses the existing admin auth + project gate; no new IAM scope
// wiring in v2.1 W4 (every team admin who can read issues can
// read checks).

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::endpoint_probe::{ProbeConfig, ProbeOutcome, run_probe};
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EndpointCheckRow {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub target_url: String,
    pub method: String,
    pub interval_sec: i32,
    pub assertion_status_codes: Vec<i32>,
    pub assertion_body_substring: Option<String>,
    pub assertion_max_latency_ms: Option<i32>,
    pub paused: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub name: String,
    pub target_url: String,
    pub method: Option<String>,
    pub interval_sec: Option<i32>,
    pub assertion_status_codes: Option<Vec<i32>>,
    pub assertion_body_substring: Option<String>,
    pub assertion_max_latency_ms: Option<i32>,
}

fn validate_url(url: &str) -> Result<(), AppError> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::BadRequest("target_url must start with http:// or https://".into()));
    }
    if url.len() > 2048 {
        return Err(AppError::BadRequest("target_url too long".into()));
    }
    Ok(())
}

fn validate_method(method: &str) -> Result<(), AppError> {
    match method {
        "GET" | "POST" | "HEAD" => Ok(()),
        _ => Err(AppError::BadRequest("method must be GET / POST / HEAD".into())),
    }
}

pub async fn create(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Json(req): Json<CreateRequest>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Err(AppError::Internal("db not configured".into()));
    };
    validate_url(&req.target_url)?;
    let method = req.method.unwrap_or_else(|| "GET".into());
    validate_method(&method)?;
    let interval = req.interval_sec.unwrap_or(60);
    if interval < 60 {
        return Err(AppError::BadRequest("interval_sec must be >= 60".into()));
    }
    let status_codes = req.assertion_status_codes.unwrap_or_else(|| vec![200]);
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO endpoint_check \
            (id, project_id, name, target_url, method, interval_sec, \
             assertion_status_codes, assertion_body_substring, \
             assertion_max_latency_ms) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(id)
    .bind(project_id)
    .bind(&req.name)
    .bind(&req.target_url)
    .bind(&method)
    .bind(interval)
    .bind(&status_codes)
    .bind(req.assertion_body_substring.as_deref())
    .bind(req.assertion_max_latency_ms)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response())
}

pub async fn list(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<EndpointCheckRow>::new()).into_response());
    };
    let rows: Vec<EndpointCheckRow> = sqlx::query_as(
        "SELECT id, project_id, name, target_url, method, interval_sec, \
                assertion_status_codes, assertion_body_substring, \
                assertion_max_latency_ms, paused, created_at, updated_at \
         FROM endpoint_check \
         WHERE project_id = $1 \
         ORDER BY created_at DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(rows).into_response())
}

pub async fn get_one(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Err(AppError::NotFound);
    };
    let row: Option<EndpointCheckRow> = sqlx::query_as(
        "SELECT id, project_id, name, target_url, method, interval_sec, \
                assertion_status_codes, assertion_body_substring, \
                assertion_max_latency_ms, paused, created_at, updated_at \
         FROM endpoint_check \
         WHERE id = $1 AND project_id = $2",
    )
    .bind(id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    match row {
        Some(r) => Ok(Json(r).into_response()),
        None => Err(AppError::NotFound),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequest {
    pub name: Option<String>,
    pub target_url: Option<String>,
    pub method: Option<String>,
    pub interval_sec: Option<i32>,
    pub assertion_status_codes: Option<Vec<i32>>,
    pub assertion_body_substring: Option<String>,
    pub assertion_max_latency_ms: Option<i32>,
    pub paused: Option<bool>,
}

pub async fn update(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateRequest>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Err(AppError::Internal("db not configured".into()));
    };
    if let Some(u) = &req.target_url {
        validate_url(u)?;
    }
    if let Some(m) = &req.method {
        validate_method(m)?;
    }
    if let Some(i) = req.interval_sec {
        if i < 60 {
            return Err(AppError::BadRequest("interval_sec must be >= 60".into()));
        }
    }
    // COALESCE per-field so the host only has to send what it
    // wants to change. Clearing optional assertions is done by
    // sending an explicit `null` — but JSON null deserialises
    // into the Option as None which we can't distinguish from
    // "field absent" with this shape. Document that explicit
    // clearing isn't supported in v2.1; recreate the check.
    sqlx::query(
        "UPDATE endpoint_check SET \
            name                     = COALESCE($3, name), \
            target_url               = COALESCE($4, target_url), \
            method                   = COALESCE($5, method), \
            interval_sec             = COALESCE($6, interval_sec), \
            assertion_status_codes   = COALESCE($7, assertion_status_codes), \
            assertion_body_substring = COALESCE($8, assertion_body_substring), \
            assertion_max_latency_ms = COALESCE($9, assertion_max_latency_ms), \
            paused                   = COALESCE($10, paused), \
            updated_at               = now() \
         WHERE id = $1 AND project_id = $2",
    )
    .bind(id)
    .bind(project_id)
    .bind(req.name.as_deref())
    .bind(req.target_url.as_deref())
    .bind(req.method.as_deref())
    .bind(req.interval_sec)
    .bind(req.assertion_status_codes.as_deref())
    .bind(req.assertion_body_substring.as_deref())
    .bind(req.assertion_max_latency_ms)
    .bind(req.paused)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn delete(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Err(AppError::Internal("db not configured".into()));
    };
    sqlx::query(
        "DELETE FROM endpoint_check WHERE id = $1 AND project_id = $2",
    )
    .bind(id)
    .bind(project_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProbeLogRow {
    #[serde(with = "time::serde::rfc3339")]
    pub ts: OffsetDateTime,
    pub status_code: i32,
    pub latency_ms: i32,
    pub ok: bool,
    pub error_kind: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeQueryParams {
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub from: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub to: Option<OffsetDateTime>,
    pub limit: Option<i64>,
}

pub async fn list_probes(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(Uuid, Uuid)>,
    Query(params): Query<ProbeQueryParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<ProbeLogRow>::new()).into_response());
    };
    let now = OffsetDateTime::now_utc();
    let to = params.to.unwrap_or(now);
    let from = params.from.unwrap_or_else(|| now - time::Duration::hours(24));
    let limit = params.limit.unwrap_or(200).clamp(1, 5000);
    // Project guard: confirm the check belongs to this project so
    // /admin/api/projects/A/.../B doesn't leak.
    let owned: Option<(bool,)> = sqlx::query_as(
        "SELECT TRUE FROM endpoint_check WHERE id = $1 AND project_id = $2",
    )
    .bind(id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    if owned.is_none() {
        return Err(AppError::NotFound);
    }
    let rows: Vec<ProbeLogRow> = sqlx::query_as(
        "SELECT ts, status_code, latency_ms, ok, error_kind \
         FROM endpoint_probe \
         WHERE check_id = $1 AND ts >= $2 AND ts < $3 \
         ORDER BY ts DESC LIMIT $4",
    )
    .bind(id)
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(rows).into_response())
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RollupRow {
    #[serde(with = "time::serde::rfc3339")]
    pub bucket_ts: OffsetDateTime,
    pub probe_count: i32,
    pub ok_count: i32,
    pub uptime_pct: f64,
    pub p50_latency_ms: i32,
    pub p95_latency_ms: i32,
}

/// v2.1.3 — "Probe now" dry-run.
///
/// Runs a one-shot probe against the check's current target/method/
/// assertions using the same `run_probe` the cron uses, but DOES NOT
/// write a row to `endpoint_probe` and DOES NOT touch the
/// consecutive-2 issue lifecycle. The result is returned synchronously
/// for the dashboard to render so an operator can verify a fresh
/// check (or one they just edited) without waiting for the next 60 s
/// tick or polluting the probe history with a manual sample.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeNowResponse {
    pub ok: bool,
    pub status_code: i32,
    pub latency_ms: i32,
    /// `null` when `ok == true`; one of `status` / `body` / `latency` /
    /// `dns` / `tcp` / `tls` / `timeout` otherwise.
    pub error_kind: Option<String>,
}

pub async fn probe_now(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Err(AppError::Internal("db not configured".into()));
    };
    let row: Option<EndpointCheckRow> = sqlx::query_as(
        "SELECT id, project_id, name, target_url, method, interval_sec, \
                assertion_status_codes, assertion_body_substring, \
                assertion_max_latency_ms, paused, created_at, updated_at \
         FROM endpoint_check \
         WHERE id = $1 AND project_id = $2",
    )
    .bind(id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let Some(check) = row else {
        return Err(AppError::NotFound);
    };
    let cfg = ProbeConfig {
        check_id: check.id,
        project_id: check.project_id,
        target_url: check.target_url,
        method: check.method,
        status_codes: check.assertion_status_codes,
        body_substring: check.assertion_body_substring,
        max_latency_ms: check.assertion_max_latency_ms,
    };
    // Build a transient client per request. The dashboard CTA is
    // human-triggered (one click → one probe), so the extra few ms
    // of TLS setup vs a pooled client is invisible and we avoid
    // threading state through AppState for one endpoint.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("sentori-endpoint-probe/2.1 (probe-now)")
        .build()
        .map_err(|e| AppError::Internal(format!("probe client init: {e}")))?;
    let probe = run_probe(&client, &cfg).await;
    let (ok, error_kind) = match probe.outcome {
        ProbeOutcome::Ok => (true, None),
        ProbeOutcome::Fail(k) => (false, Some(k.to_string())),
    };
    let body = ProbeNowResponse {
        ok,
        status_code: probe.status_code,
        latency_ms: probe.latency_ms,
        error_kind,
    };
    Ok(Json(body).into_response())
}

pub async fn list_rollup(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(Uuid, Uuid)>,
    Query(params): Query<ProbeQueryParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<RollupRow>::new()).into_response());
    };
    let now = OffsetDateTime::now_utc();
    let to = params.to.unwrap_or(now);
    let from = params.from.unwrap_or_else(|| now - time::Duration::hours(24));
    let owned: Option<(bool,)> = sqlx::query_as(
        "SELECT TRUE FROM endpoint_check WHERE id = $1 AND project_id = $2",
    )
    .bind(id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    if owned.is_none() {
        return Err(AppError::NotFound);
    }
    let rows: Vec<RollupRow> = sqlx::query_as(
        "SELECT bucket_ts, probe_count, ok_count, uptime_pct, p50_latency_ms, p95_latency_ms \
         FROM endpoint_probe_1h \
         WHERE check_id = $1 AND bucket_ts >= $2 AND bucket_ts < $3 \
         ORDER BY bucket_ts DESC LIMIT 1000",
    )
    .bind(id)
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(rows).into_response())
}
