//! PUT `/v1/push/users/{fp_hex}/preferences/{category}` — update push category opt-in.
use axum::{Extension, Json, extract::Path, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path((fp_hex, category)): Path<(String, String)>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %fp_hex,
        %category,
        payload_bytes = serde_json::to_string(&payload).map(|s| s.len()).unwrap_or(0),
        "push.put_preference",
    );
    (StatusCode::ACCEPTED, Json(json!({ "status": "updated", "stub": "push_put_preference" })))
}
