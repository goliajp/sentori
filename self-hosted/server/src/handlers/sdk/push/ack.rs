//! POST `/v1/push/sends/{send_id}/ack` — mark push as user-confirmed.
use axum::{Extension, Json, extract::Path, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use uuid::Uuid;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path(send_id): Path<Uuid>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %send_id,
        payload_bytes = serde_json::to_string(&payload).map(|s| s.len()).unwrap_or(0),
        "push.ack",
    );
    (StatusCode::ACCEPTED, Json(json!({ "status": "acked", "stub": "push_ack" })))
}
