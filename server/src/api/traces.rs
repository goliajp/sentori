// Phase 36 sub-A: dashboard trace-list endpoint.
//
// `GET /admin/api/projects/{project_id}/traces?...` returns a slice of
// the `traces` materialized table (sub-B Phase 34) with the same
// keyset-cursor pagination shape as `list_issues` — JSON-array body +
// `X-Next-Cursor` response header.

use axum::{
    extract::{Json, Path, Query, State},
    http::HeaderValue,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TraceRow {
    pub trace_id: Uuid,
    pub root_op: Option<String>,
    pub root_name: Option<String>,
    pub span_count: i32,
    pub status: String,
    pub duration_ms: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTracesQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    /// Filter on `traces.root_op` (exact match).
    #[serde(default)]
    pub op: Option<String>,
    /// Filter on `traces.status` (`ok` / `error` / `cancelled`).
    #[serde(default)]
    pub status: Option<String>,
    /// Minimum duration in milliseconds — `?durationMs=500` keeps only
    /// traces ≥ 500 ms. Used to surface slow requests in the list.
    #[serde(default)]
    pub duration_ms: Option<i32>,
    /// Keyset cursor — `<rfc3339-last-seen>|<uuid>`, same format as
    /// `list_issues`.
    #[serde(default)]
    pub cursor: Option<String>,
}

pub async fn list_traces(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListTracesQuery>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);

    let cursor: Option<(OffsetDateTime, Uuid)> = q.cursor.as_deref().and_then(parse_cursor);

    let rows: Vec<TraceRow> = sqlx::query_as(
        r#"
        SELECT trace_id, root_op, root_name, span_count, status, duration_ms,
               first_seen, last_seen
        FROM traces
        WHERE project_id = $1
          AND ($2::TEXT IS NULL OR root_op = $2)
          AND ($3::TEXT IS NULL OR status = $3)
          AND ($4::INT  IS NULL OR duration_ms >= $4)
          AND (
            $5::TIMESTAMPTZ IS NULL
            OR last_seen < $5::TIMESTAMPTZ
            OR (last_seen = $5::TIMESTAMPTZ AND trace_id < $6::UUID)
          )
        ORDER BY last_seen DESC, trace_id DESC
        LIMIT $7
        "#,
    )
    .bind(project_id)
    .bind(q.op.as_deref())
    .bind(q.status.as_deref())
    .bind(q.duration_ms)
    .bind(cursor.map(|c| c.0))
    .bind(cursor.map(|c| c.1))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut response = Json(&rows).into_response();
    if rows.len() as i64 == limit {
        if let Some(last) = rows.last() {
            let cursor_value = encode_cursor(last.last_seen, last.trace_id);
            if let Ok(header) = HeaderValue::from_str(&cursor_value) {
                response.headers_mut().insert("X-Next-Cursor", header);
            }
        }
    }
    Ok(response)
}

fn encode_cursor(last_seen: OffsetDateTime, trace_id: Uuid) -> String {
    format!(
        "{}|{}",
        last_seen
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        trace_id
    )
}

fn parse_cursor(s: &str) -> Option<(OffsetDateTime, Uuid)> {
    let (ts, id) = s.split_once('|')?;
    let last_seen = OffsetDateTime::parse(ts, &time::format_description::well_known::Rfc3339).ok()?;
    let id = Uuid::parse_str(id).ok()?;
    Some((last_seen, id))
}

/// Phase 36 sub-B: trace detail. Returns:
///   { trace: {trace_id, root_op, ...}, spans: [...] }
/// `spans` is the full set for that trace_id, sorted by started_at
/// asc so the client can build the parent_span_id tree in one pass.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceDetail {
    pub trace: TraceRow,
    pub spans: Vec<SpanRow>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SpanRow {
    pub id: Uuid,
    pub trace_id: Uuid,
    pub parent_span_id: Option<Uuid>,
    pub op: String,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    pub duration_ms: i32,
    pub status: String,
    pub tags: JsonValue,
    pub data: Option<JsonValue>,
}

pub async fn trace_detail(
    State(state): State<AppState>,
    Path((project_id, trace_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<TraceDetail>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    let trace: Option<TraceRow> = sqlx::query_as(
        r#"
        SELECT trace_id, root_op, root_name, span_count, status, duration_ms,
               first_seen, last_seen
        FROM traces
        WHERE trace_id = $1 AND project_id = $2
        "#,
    )
    .bind(trace_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let trace = trace.ok_or(AppError::NotFound)?;

    let spans: Vec<SpanRow> = sqlx::query_as(
        r#"
        SELECT id, trace_id, parent_span_id, op, name, started_at,
               duration_ms, status, tags, data
        FROM spans
        WHERE trace_id = $1 AND project_id = $2
        ORDER BY started_at ASC, id ASC
        "#,
    )
    .bind(trace_id)
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(TraceDetail { trace, spans }))
}
