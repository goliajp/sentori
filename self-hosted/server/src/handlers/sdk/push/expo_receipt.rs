//! GET `/v1/push/expo-compat/receipts/{send_id}` — Expo SDK adapter receipt.
use axum::{Extension, Json, extract::Path};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use uuid::Uuid;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path(send_id): Path<Uuid>,
) -> Json<Value> {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %send_id,
        "push.expo_receipt",
    );
    Json(json!({ "data": { "status": "ok", "stub": "push_expo_receipt" } }))
}
