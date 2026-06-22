//! POST `/v1/events` — single event ingest (SDK wire-format).
//!
//! Accepts the legacy SDK JSON payload, maps it to v0.1's
//! `event-pipeline::Event` shape, and persists via
//! `IngestService::ingest`. Returns the issue id + whether the
//! issue is new + whether it flipped from resolved to regressed.

use std::sync::Arc;

use axum::{Extension, Json, extract::State, http::StatusCode};
use sentori_event_pipeline::{Event, EventKind, IngestError, MessageLevel, Platform};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use time::OffsetDateTime;
use tracing::{info, warn};
use uuid::Uuid;

use crate::state::AppState;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let event = match map_payload(payload) {
        Ok(e) => e,
        Err(msg) => {
            warn!(workspace_id = %ctx.workspace_id, error = %msg, "sdk.events bad_payload");
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_payload", "detail": msg })),
            );
        }
    };

    match state.ingest.ingest(ctx.project_id, event).await {
        Ok(outcome) => {
            info!(
                workspace_id = %ctx.workspace_id,
                project_id = %ctx.project_id,
                issue_id = %outcome.issue_id,
                is_new = outcome.is_new_issue,
                regressed = outcome.regressed,
                "sdk.events ingested",
            );
            (
                StatusCode::ACCEPTED,
                Json(json!({
                    "event_id": outcome.event_id.to_string(),
                    "issue_id": outcome.issue_id.to_string(),
                    "is_new_issue": outcome.is_new_issue,
                    "regressed": outcome.regressed,
                })),
            )
        }
        Err(IngestError::ProjectNotFound(_)) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "project_not_found" })),
        ),
        Err(IngestError::InvalidEvent(msg)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid_event", "detail": msg })),
        ),
        Err(e) => {
            warn!(workspace_id = %ctx.workspace_id, error = %e, "sdk.events db_error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}

/// Public alias for use by `events_batch::handle`.
#[inline]
pub(crate) fn map_payload_pub(p: Value) -> Result<Event, String> {
    map_payload(p)
}

/// Map legacy SDK wire JSON to v0.1 `Event`.
fn map_payload(mut p: Value) -> Result<Event, String> {
    let obj = p.as_object_mut().ok_or("expected JSON object")?;

    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .unwrap_or_else(Uuid::now_v7);

    let timestamp = obj
        .get("timestamp")
        .and_then(|v| v.as_str())
        .and_then(|s| OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok())
        .unwrap_or_else(OffsetDateTime::now_utc);

    let kind_str = obj
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or("missing `kind`")?;
    let kind = match kind_str {
        "error" => EventKind::Error,
        "anr" => EventKind::Anr,
        "nearCrash" | "near_crash" => EventKind::NearCrash,
        "message" => EventKind::Message,
        other => return Err(format!("unknown kind: {other}")),
    };

    let platform_str = obj
        .get("platform")
        .and_then(|v| v.as_str())
        .ok_or("missing `platform`")?;
    let platform = match platform_str {
        "javascript" => Platform::Javascript,
        "ios" => Platform::Ios,
        "android" => Platform::Android,
        other => return Err(format!("unknown platform: {other}")),
    };

    let release = obj
        .get("release")
        .and_then(|v| v.as_str())
        .ok_or("missing `release`")?
        .to_string();

    let environment = obj
        .get("environment")
        .and_then(|v| v.as_str())
        .ok_or("missing `environment`")?
        .to_string();

    let error_type = obj
        .get("error")
        .and_then(|v| v.get("type"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let message = obj
        .get("message")
        .and_then(|v| v.as_str())
        .map(String::from);

    let level = obj
        .get("level")
        .and_then(|v| v.as_str())
        .and_then(|s| match s {
            "fatal" => Some(MessageLevel::Fatal),
            "error" => Some(MessageLevel::Error),
            "warning" => Some(MessageLevel::Warning),
            "info" => Some(MessageLevel::Info),
            "debug" => Some(MessageLevel::Debug),
            _ => None,
        });

    let fingerprint_override = obj
        .get("fingerprint")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .map(String::from);

    Ok(Event {
        id,
        timestamp,
        kind,
        platform,
        release,
        environment,
        error_type,
        message,
        level,
        frame: None, // Phase C step 4 — symbolicator integration
        fingerprint_override,
        payload: Value::Object(obj.clone()),
    })
}
