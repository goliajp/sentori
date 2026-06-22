//! GET `/v1/push/receipts/{send_id}` — poll delivery receipt status.
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
        "push.receipt",
    );
    Json(json!({ "send_id": send_id.to_string(), "status": "pending", "stub": "push_receipt" }))
}
