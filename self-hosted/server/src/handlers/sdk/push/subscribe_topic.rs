//! POST `/v1/push/tokens/{handle}/topics` — subscribe device to topic.
use axum::{Extension, Json, extract::Path, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path(handle): Path<String>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %handle,
        payload_bytes = serde_json::to_string(&payload).map(|s| s.len()).unwrap_or(0),
        "push.subscribe_topic",
    );
    (StatusCode::ACCEPTED, Json(json!({ "status": "subscribed", "stub": "push_subscribe_topic" })))
}
