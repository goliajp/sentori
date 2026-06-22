//! DELETE `/v1/push/tokens/{handle}` — revoke a device token.
use axum::{Extension, Json, extract::Path, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path(handle): Path<String>,
) -> (StatusCode, Json<Value>) {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %handle,
        "push.revoke_token",
    );
    (StatusCode::ACCEPTED, Json(json!({ "status": "revoked", "stub": "push_revoke_token" })))
}
