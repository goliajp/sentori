//! POST `/v1/spans:batch` — batched spans (≤ 100).

use std::sync::Arc;

use axum::{Extension, Json, extract::State, http::StatusCode};
use sentori_ingest_token::IngestContext;
use sentori_span_store::SpanInput;
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::state::AppState;

const MAX_BATCH_SIZE: usize = 100;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let arr = if let Some(a) = payload.as_array() {
        a.clone()
    } else if let Some(a) = payload.get("spans").and_then(|v| v.as_array()) {
        a.clone()
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "expected array or { spans: [...] }" })),
        );
    };

    if arr.len() > MAX_BATCH_SIZE {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "batch too large",
                "max": MAX_BATCH_SIZE,
                "got": arr.len(),
            })),
        );
    }

    let mut accepted = 0u32;
    let mut failed = 0u32;
    for raw in arr {
        let Ok(input) = serde_json::from_value::<SpanInput>(raw) else {
            failed += 1;
            continue;
        };
        match state.spans.ingest_span(ctx.project_id, input).await {
            Ok(_) => accepted += 1,
            Err(e) => {
                failed += 1;
                warn!(workspace_id = %ctx.workspace_id, error = %e, "sdk.spans_batch item_failed");
            }
        }
    }

    info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        accepted, failed,
        "sdk.spans_batch processed",
    );

    (
        StatusCode::ACCEPTED,
        Json(json!({ "accepted": accepted, "failed": failed })),
    )
}
