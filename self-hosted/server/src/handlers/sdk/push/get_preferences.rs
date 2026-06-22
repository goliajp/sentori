//! GET `/v1/push/users/{fp_hex}/preferences` — fetch user's push category preferences.
use axum::{Extension, Json, extract::Path};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path(fp_hex): Path<String>,
) -> Json<Value> {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %fp_hex,
        "push.get_preferences",
    );
    Json(json!({ "preferences": [], "stub": "push_get_preferences" }))
}
