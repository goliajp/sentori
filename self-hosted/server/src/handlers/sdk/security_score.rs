//! GET `/v1/security/score` — SDK polls current trust score.
//!
//! Phase C step 2 stub. Returns a fixed score=100 placeholder.
//! Phase C step 3+ replaces with security-engine crate integration.

use axum::{Extension, Json};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};

pub async fn handle(Extension(ctx): Extension<IngestContext>) -> Json<Value> {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        "sdk.security_score",
    );
    Json(json!({ "score": 100, "stub": "security_score" }))
}
