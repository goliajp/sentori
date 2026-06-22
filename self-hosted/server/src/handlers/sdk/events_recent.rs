//! GET `/v1/events/_recent` — live tick SSE feed (internal,
//! used by dashboard).
//!
//! Phase C step 2 stub. Returns 501 Not Implemented until SSE
//! infrastructure wired. Phase C step 3+ replaces with broadcast
//! channel + axum SSE stream.

use axum::{Extension, Json, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(Extension(ctx): Extension<IngestContext>) -> (StatusCode, Json<Value>) {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        "sdk.events_recent",
    );
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": "events_recent SSE not yet wired", "stub": "events_recent" })),
    )
}
