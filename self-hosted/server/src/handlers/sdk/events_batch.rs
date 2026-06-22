//! POST `/v1/events:batch` — batched events (≤ 100).
//!
//! Each event passes through the same `map_payload + IngestService::ingest`
//! pipeline as `/v1/events`. Per-event failures are tallied in
//! the response so the SDK can decide whether to retry the whole
//! batch (HTTP success with a non-zero `failed`) or fail-hard
//! (HTTP 4xx).

use std::sync::Arc;

use axum::{Extension, Json, extract::State, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::handlers::sdk::events::map_payload_pub;
use crate::state::AppState;

const MAX_BATCH_SIZE: usize = 100;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    // Accept either bare array OR `{ events: [...] }`.
    let events = if let Some(arr) = payload.as_array() {
        arr.clone()
    } else if let Some(arr) = payload.get("events").and_then(|v| v.as_array()) {
        arr.clone()
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "expected array or { events: [...] }" })),
        );
    };

    if events.len() > MAX_BATCH_SIZE {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "batch too large",
                "max": MAX_BATCH_SIZE,
                "got": events.len(),
            })),
        );
    }

    let mut accepted = 0u32;
    let mut failed = 0u32;
    let mut results: Vec<Value> = Vec::with_capacity(events.len());

    for raw in events {
        let event = match map_payload_pub(raw) {
            Ok(e) => e,
            Err(msg) => {
                failed += 1;
                results.push(json!({ "ok": false, "error": "invalid_payload", "detail": msg }));
                continue;
            }
        };

        match state.ingest.ingest(ctx.project_id, event).await {
            Ok(outcome) => {
                accepted += 1;
                results.push(json!({
                    "ok": true,
                    "event_id": outcome.event_id.to_string(),
                    "issue_id": outcome.issue_id.to_string(),
                    "is_new_issue": outcome.is_new_issue,
                    "regressed": outcome.regressed,
                }));
            }
            Err(e) => {
                failed += 1;
                warn!(workspace_id = %ctx.workspace_id, error = %e, "sdk.events_batch item_failed");
                results.push(json!({ "ok": false, "error": e.to_string() }));
            }
        }
    }

    info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        accepted,
        failed,
        "sdk.events_batch processed",
    );

    (
        StatusCode::ACCEPTED,
        Json(json!({
            "accepted": accepted,
            "failed": failed,
            "results": results,
        })),
    )
}
