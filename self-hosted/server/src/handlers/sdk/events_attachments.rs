//! POST `/v1/events/:event_id/attachments/:kind` — upload a blob
//! attached to an event (replay / screenshot / sourcemap / dsym
//! / proguard).
//!
//! Path params:
//! - `event_id` — UUID of the originating event (does not have to
//!   exist yet; the FK is `ON DELETE SET NULL` for late binding)
//! - `kind` — one of `replay` / `screenshot` / `sourcemap` /
//!   `dsym` / `proguard` / `mapping`
//!
//! Body: raw bytes (not multipart in v0.2 — SDK uploads single-
//! file blob in body for simplicity). Content-Type passes through
//! to the stored row.
//!
//! Stores the blob in `state.replays` (the MemoryBlobStore which
//! is also used for general attachments) and INSERTs metadata
//! row in `event_attachments` (migration 0022).

use std::sync::Arc;

use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use tracing::{info, warn};
use uuid::Uuid;

use crate::state::AppState;

const MAX_BODY_BYTES: usize = 50 * 1024 * 1024; // 50 MiB hard cap

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Path((event_id, kind)): Path<(Uuid, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    if !matches!(
        kind.as_str(),
        "replay" | "screenshot" | "sourcemap" | "dsym" | "proguard" | "mapping" | "trail"
    ) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid_kind", "got": kind })),
        );
    }
    if body.len() > MAX_BODY_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({
                "error": "too_large",
                "max": MAX_BODY_BYTES,
                "got": body.len(),
            })),
        );
    }
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "empty_body" })),
        );
    }

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    // Body length is already bounded by the request body limit, so
    // this cannot saturate in practice.
    let size_bytes = i64::try_from(body.len()).unwrap_or(i64::MAX);

    // Store the blob. Phase D step 2 uses AppState's shared
    // MemoryBlobStore; Phase E swaps to LocalFsBlobStore (S3
    // adapter still future work).
    let hash = match state.attachments.put(&body).await {
        Ok(h) => h,
        Err(e) => {
            warn!(workspace_id = %ctx.workspace_id, error = %e, "sdk.attachments blob_store_error");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "blob_store_failed" })),
            );
        }
    };
    let blob_hash_hex = hash.to_hex();

    // INSERT metadata row.
    let id = Uuid::now_v7();
    let result = sqlx::query(
        "INSERT INTO event_attachments \
         (id, workspace_id, project_id, event_id, kind, content_type, size_bytes, blob_hash) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(ctx.workspace_id.into_uuid())
    .bind(ctx.project_id.into_uuid())
    .bind(event_id)
    .bind(&kind)
    .bind(&content_type)
    .bind(size_bytes)
    .bind(&blob_hash_hex)
    .execute(&state.pool)
    .await;

    match result {
        Ok(_) => {
            info!(
                workspace_id = %ctx.workspace_id,
                project_id = %ctx.project_id,
                %event_id,
                %kind,
                size_bytes,
                "sdk.attachments stored",
            );
            (
                StatusCode::ACCEPTED,
                Json(json!({
                    "attachment_id": id.to_string(),
                    "blob_hash": blob_hash_hex,
                    "size_bytes": size_bytes,
                })),
            )
        }
        Err(e) => {
            warn!(workspace_id = %ctx.workspace_id, error = %e, "sdk.attachments db_error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}
