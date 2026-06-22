//! DELETE `/v1/push/tokens/{handle}/topics/{topic}` — unsubscribe device from topic.
use axum::{Extension, Json, extract::Path, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path((handle, topic)): Path<(String, String)>,
) -> (StatusCode, Json<Value>) {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %handle,
        %topic,
        "push.unsubscribe_topic",
    );
    (StatusCode::ACCEPTED, Json(json!({ "status": "unsubscribed", "stub": "push_unsubscribe_topic" })))
}
