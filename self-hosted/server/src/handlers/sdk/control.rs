//! GET `/v1/control/poll` — SDK discovers live-mode flag.
//!
//! Phase C step 2 stub. Returns `{ "live": false }` placeholder.
//! Phase C step 3+ replaces with control-channel crate integration.

use axum::{Extension, Json};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(Extension(ctx): Extension<IngestContext>) -> Json<Value> {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        "sdk.control_poll",
    );
    Json(json!({ "live": false, "stub": "control_poll" }))
}
