// Phase 34 sub-C: span ingest.
//
// `POST /v1/spans` and `POST /v1/spans:batch`. Auth and rate limit live
// in the same `require_token` group as `/v1/events` — spans share the
// per-org ingest budget. Spec: docs/protocol.md#span-schema.

use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::events::{caller_project_id, quota_exceeded_response};
use crate::auth::IngestCaller;
use crate::quotas::{self, QuotaDecision};
use crate::recent::AppState;

const OP_MAX: usize = 64;
const NAME_MAX: usize = 200;
const TAG_KEY_MAX: usize = 64;
const TAG_VAL_MAX: usize = 200;
const TAG_COUNT_MAX: usize = 50;
const DATA_BYTES_MAX: usize = 16 * 1024;
const DURATION_MS_MAX: i32 = 24 * 60 * 60 * 1000;
const MAX_BATCH_SPANS: usize = 200;
const VALID_STATUSES: &[&str] = &["ok", "error", "cancelled"];

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanInput {
    pub id: Uuid,
    pub trace_id: Uuid,
    pub parent_span_id: Option<Uuid>,
    pub op: String,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    pub duration_ms: i32,
    pub status: String,
    #[serde(default)]
    pub tags: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    /// Original W3C traceparent header value if this span was continued
    /// from another process. Optional; not displayed in the dashboard.
    #[serde(default)]
    pub traceparent: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpanAck {
    pub id: Uuid,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpansBatchRequest {
    pub spans: Vec<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpansBatchResponse {
    pub accepted: u32,
    pub rejected: u32,
    pub errors: Vec<BatchError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchError {
    pub index: u32,
    pub error: &'static str,
    pub detail: Option<String>,
}

/// `POST /v1/spans` — single span.
pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(body): Json<SpanInput>,
) -> Response {
    let project_id = caller_project_id(&caller, &state);

    if let Err(reason) = validate(&body) {
        return bad_request(reason);
    }

    // Quota gate — same per-org bucket as /v1/events. Skipped for the
    // dev token to keep single-tenant local flow unconstrained.
    if let (IngestCaller::Token { org_id, .. }, Some(pool), Some(valkey)) =
        (&caller, &state.db, &state.valkey)
    {
        let now = OffsetDateTime::now_utc();
        match quotas::check_and_record(pool, valkey.clone(), *org_id, now).await {
            Ok(QuotaDecision::Allowed { .. }) => {}
            Ok(QuotaDecision::Exceeded { reset_at, .. }) => {
                return quota_exceeded_response(reset_at);
            }
            Err(e) => {
                tracing::error!(error = %e, "quota check failed; admitting span");
            }
        }
    }

    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    if let Err(e) = persist_span(&pool, project_id, &body).await {
        tracing::error!(error = %e, %project_id, span_id = %body.id, "span insert failed");
        return server_error("insert");
    }

    (StatusCode::ACCEPTED, Json(SpanAck { id: body.id })).into_response()
}

/// `POST /v1/spans:batch` — up to 200 spans per request. Per-span
/// validation/persist failures don't fail the batch.
pub async fn handle_batch(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(req): Json<SpansBatchRequest>,
) -> Response {
    if req.spans.len() > MAX_BATCH_SPANS {
        return bad_request("tooManySpans");
    }

    let project_id = caller_project_id(&caller, &state);
    let mut accepted = 0u32;
    let mut rejected = 0u32;
    let mut errors = Vec::new();

    // Quota check once per batch — same posture as events:batch (the
    // batch counts as a single ingest write).
    if let (IngestCaller::Token { org_id, .. }, Some(pool), Some(valkey)) =
        (&caller, &state.db, &state.valkey)
    {
        let now = OffsetDateTime::now_utc();
        if let Ok(QuotaDecision::Exceeded { reset_at, .. }) =
            quotas::check_and_record(pool, valkey.clone(), *org_id, now).await
        {
            return quota_exceeded_response(reset_at);
        }
    }

    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    for (i, raw) in req.spans.into_iter().enumerate() {
        match serde_json::from_value::<SpanInput>(raw) {
            Ok(span) => {
                if let Err(reason) = validate(&span) {
                    rejected += 1;
                    errors.push(BatchError {
                        index: i as u32,
                        error: "validationFailed",
                        detail: Some(reason.into()),
                    });
                    continue;
                }
                match persist_span(&pool, project_id, &span).await {
                    Ok(()) => accepted += 1,
                    Err(e) => {
                        tracing::error!(error = %e, %project_id, span_id = %span.id, "span insert failed (batch)");
                        rejected += 1;
                        errors.push(BatchError {
                            index: i as u32,
                            error: "persistFailed",
                            detail: None,
                        });
                    }
                }
            }
            Err(e) => {
                rejected += 1;
                errors.push(BatchError {
                    index: i as u32,
                    error: "invalidJson",
                    detail: Some(e.to_string()),
                });
            }
        }
    }

    (
        StatusCode::ACCEPTED,
        Json(SpansBatchResponse {
            accepted,
            rejected,
            errors,
        }),
    )
        .into_response()
}

fn validate(s: &SpanInput) -> Result<(), &'static str> {
    if s.op.is_empty() || s.op.len() > OP_MAX {
        return Err("invalidOp");
    }
    if s.name.is_empty() || s.name.len() > NAME_MAX {
        return Err("invalidName");
    }
    if !VALID_STATUSES.contains(&s.status.as_str()) {
        return Err("invalidStatus");
    }
    if s.duration_ms < 0 || s.duration_ms > DURATION_MS_MAX {
        return Err("invalidDurationMs");
    }
    if s.tags.len() > TAG_COUNT_MAX {
        return Err("tooManyTags");
    }
    for (k, v) in &s.tags {
        if k.is_empty() || k.len() > TAG_KEY_MAX {
            return Err("invalidTagKey");
        }
        // Tag values are strings on the wire; reject non-string here so
        // dashboard filter UX doesn't have to render objects/arrays.
        let Some(val) = v.as_str() else {
            return Err("invalidTagValue");
        };
        if val.len() > TAG_VAL_MAX {
            return Err("invalidTagValue");
        }
    }
    if let Some(data) = &s.data {
        // Approximate size — full JSON encode and check the byte length.
        // Cheap because span.data is tiny in practice.
        let encoded = serde_json::to_vec(data).unwrap_or_default();
        if encoded.len() > DATA_BYTES_MAX {
            return Err("dataTooLarge");
        }
    }
    Ok(())
}

/// Insert one span and roll the parent trace's summary forward in the
/// same transaction. The trace row carries root_op / root_name /
/// duration_ms only when this span IS the root (`parent_span_id IS
/// NULL`); for child spans those columns retain the value the root
/// already set (or NULL if the root hasn't arrived yet).
async fn persist_span(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    s: &SpanInput,
) -> sqlx::Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO spans
            (id, project_id, trace_id, parent_span_id, started_at,
             duration_ms, op, name, status, tags, data, traceparent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#,
    )
    .bind(s.id)
    .bind(project_id)
    .bind(s.trace_id)
    .bind(s.parent_span_id)
    .bind(s.started_at)
    .bind(s.duration_ms)
    .bind(&s.op)
    .bind(&s.name)
    .bind(&s.status)
    .bind(serde_json::Value::Object(s.tags.clone()))
    .bind(s.data.clone())
    .bind(s.traceparent.as_deref())
    .execute(&mut *tx)
    .await?;

    let is_root = s.parent_span_id.is_none();
    let root_op: Option<&str> = if is_root { Some(&s.op) } else { None };
    let root_name: Option<&str> = if is_root { Some(&s.name) } else { None };
    let root_duration: i32 = if is_root { s.duration_ms } else { 0 };

    sqlx::query(
        r#"
        INSERT INTO traces
            (trace_id, project_id, root_op, root_name,
             first_seen, last_seen, span_count, status, duration_ms)
        VALUES
            ($1, $2, $3, $4, now(), now(), 1, $5, $6)
        ON CONFLICT (trace_id) DO UPDATE SET
            last_seen   = GREATEST(traces.last_seen, EXCLUDED.last_seen),
            span_count  = traces.span_count + 1,
            root_op     = COALESCE(EXCLUDED.root_op, traces.root_op),
            root_name   = COALESCE(EXCLUDED.root_name, traces.root_name),
            duration_ms = GREATEST(traces.duration_ms, EXCLUDED.duration_ms),
            status      = CASE
                WHEN traces.status = 'error' OR EXCLUDED.status = 'error' THEN 'error'
                WHEN traces.status = 'cancelled' OR EXCLUDED.status = 'cancelled' THEN 'cancelled'
                ELSE 'ok'
            END
        "#,
    )
    .bind(s.trace_id)
    .bind(project_id)
    .bind(root_op)
    .bind(root_name)
    .bind(&s.status)
    .bind(root_duration)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_span() -> SpanInput {
        SpanInput {
            id: Uuid::now_v7(),
            trace_id: Uuid::now_v7(),
            parent_span_id: None,
            op: "http.client".into(),
            name: "GET /v1/users/me".into(),
            started_at: OffsetDateTime::now_utc(),
            duration_ms: 142,
            status: "ok".into(),
            tags: Default::default(),
            data: None,
            traceparent: None,
        }
    }

    #[test]
    fn accepts_minimal_valid_span() {
        assert!(validate(&valid_span()).is_ok());
    }

    #[test]
    fn rejects_empty_op() {
        let mut s = valid_span();
        s.op = String::new();
        assert_eq!(validate(&s), Err("invalidOp"));
    }

    #[test]
    fn rejects_too_long_op() {
        let mut s = valid_span();
        s.op = "x".repeat(OP_MAX + 1);
        assert_eq!(validate(&s), Err("invalidOp"));
    }

    #[test]
    fn rejects_unknown_status() {
        let mut s = valid_span();
        s.status = "bogus".into();
        assert_eq!(validate(&s), Err("invalidStatus"));
    }

    #[test]
    fn rejects_negative_duration() {
        let mut s = valid_span();
        s.duration_ms = -1;
        assert_eq!(validate(&s), Err("invalidDurationMs"));
    }

    #[test]
    fn rejects_24h_plus_duration() {
        let mut s = valid_span();
        s.duration_ms = DURATION_MS_MAX + 1;
        assert_eq!(validate(&s), Err("invalidDurationMs"));
    }

    #[test]
    fn rejects_non_string_tag_value() {
        let mut s = valid_span();
        s.tags
            .insert("http.status".into(), serde_json::json!(200));
        assert_eq!(validate(&s), Err("invalidTagValue"));
    }

    #[test]
    fn accepts_root_with_null_parent() {
        let mut s = valid_span();
        s.parent_span_id = None;
        assert!(validate(&s).is_ok());
    }
}
