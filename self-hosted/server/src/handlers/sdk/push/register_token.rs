//! POST `/v1/push/tokens` — register device for push
//!
//! Phase D stub. Accepts payload (where applicable), logs the
//! call with token context, returns 202 Accepted with minimal
//! body. Phase D step 2+ replaces with push-provider crate
//! integration.

use axum::{Extension, Json, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use tracing::info;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        "push.register_token",
    );
    (
        StatusCode::ACCEPTED,
        Json(json!({ "status": "accepted", "stub": "push_register_token" })),
    )
}
