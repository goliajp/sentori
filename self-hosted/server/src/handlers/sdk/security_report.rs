//! POST `/v1/security:report` — trust score inputs
//!
//! Phase C step 2 stub. Accepts the legacy SDK wire format
//! (serde_json::Value), logs the call with token context,
//! returns 202 Accepted with minimal body. Phase C step 3+
//! replaces this with the actual service-crate integration.

use axum::{Extension, Json, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use tracing::info;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let payload_size = serde_json::to_string(&payload).map(|s| s.len()).unwrap_or(0);
    info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        token_kind = ?ctx.token_kind,
        payload_bytes = payload_size,
        "sdk.security_report",
    );
    (
        StatusCode::ACCEPTED,
        Json(json!({ "status": "accepted", "stub": "security_report" })),
    )
}
