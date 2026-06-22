//! POST `/v1/events/:event_id/attachments/:kind` — upload replay
//! / screenshot / sourcemap / dsym / proguard blob for an event.
//!
//! Path params:
//! - `event_id` — UUID of the originating event
//! - `kind` — one of `replay`, `screenshot`, `sourcemap`, `dsym`,
//!   `proguard`
//!
//! Body: multipart/form-data with the blob bytes.
//!
//! Phase C step 2 stub. Returns 202 with `{ attachment_id }`
//! placeholder. Phase C step 3+ replaces with attachment-store
//! crate integration.

use axum::{
    Extension, Json,
    extract::{Path, Request},
    http::StatusCode,
};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use uuid::Uuid;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    Path((event_id, kind)): Path<(Uuid, String)>,
    _req: Request,
) -> (StatusCode, Json<Value>) {
    tracing::info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        %event_id,
        %kind,
        "sdk.events_attachments",
    );
    let attachment_id = Uuid::now_v7();
    (
        StatusCode::ACCEPTED,
        Json(json!({
            "status": "accepted",
            "attachment_id": attachment_id.to_string(),
            "stub": "events_attachments"
        })),
    )
}
