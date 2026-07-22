//! Uploading the files that turn a minified frame back into source.
//!
//! `release_artifacts` and the three resolver crates
//! (`sourcemap-resolver`, `dwarf-resolver`, `proguard-resolver`) have
//! both existed since before the v0.2 cutover, with tests and
//! benchmarks. Nothing connected them: there was no way to put a file
//! in, so ingest had nothing to symbolicate against and left
//! `frame: None` behind a TODO.
//!
//! A build produces these once, at ship time, so the endpoint is
//! deliberately dull: POST the file, get an id. The interesting work
//! happens at ingest, where a stack arrives and has to be matched
//! against the right release.
//!
//! Content is stored in the blob store and referenced by hash, so two
//! releases sharing an artifact store one copy — a React Native
//! sourcemap for an unchanged JS bundle is byte-identical across a
//! native-only rebuild.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Extension, Multipart, Path, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::session_mw::SessionContext;
use crate::state::AppState;

/// What a symbolicator can consume. Anything else is a typo, and
/// storing it would mean an artifact that silently never matches.
const KINDS: [&str; 4] = ["sourcemap", "dsym", "proguard", "bundle"];

/// 200 MB. A dSYM for a large app is tens of megabytes; a sourcemap is
/// single-digit. The cap exists so a mistaken upload cannot fill the
/// blob volume, not because any real artifact approaches it.
const MAX_BYTES: usize = 200 * 1024 * 1024;

/// `POST /admin/api/projects/:project_id/releases/:release_id/artifacts`
///
/// multipart: `kind` (text), `file` (the artifact).
pub async fn upload(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path((project_id, release_id)): Path<(Uuid, Uuid)>,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    super::tenant::guard_project(&state, ctx.workspace_id, project_id)
        .await
        .map_err(|(s, m)| (s, Json(json!({ "error": m }))))?;

    let (kind, name, bytes) = read_upload(multipart)
        .await
        .map_err(|m| (StatusCode::BAD_REQUEST, Json(json!({ "error": m }))))?;

    let hash = state.attachments.put(&bytes).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    // The table's unique key is (release_id, name), so a re-upload
    // after a failed ship replaces rather than accumulating
    // near-duplicates a symbolicator would have to choose between.
    let row = sqlx::query(
        "INSERT INTO release_artifacts \
           (id, workspace_id, release_id, kind, name, content_hash, blob_path, \
            uncompressed_size_bytes, created_at) \
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $5, $6, now()) \
         ON CONFLICT (release_id, name) DO UPDATE \
           SET kind = EXCLUDED.kind, \
               content_hash = EXCLUDED.content_hash, \
               blob_path = EXCLUDED.blob_path, \
               uncompressed_size_bytes = EXCLUDED.uncompressed_size_bytes, \
               created_at = now() \
         RETURNING id",
    )
    .bind(ctx.workspace_id.into_uuid())
    .bind(release_id)
    .bind(&kind)
    .bind(&name)
    .bind(hash.to_hex())
    .bind(i64::try_from(bytes.len()).unwrap_or(i64::MAX))
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        )
    })?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "id": row.get::<Uuid, _>("id"),
            "kind": kind,
            "name": name,
            "content_hash": hash.to_hex(),
            "size_bytes": bytes.len(),
        })),
    ))
}

async fn read_upload(mut multipart: Multipart) -> Result<(String, String, Vec<u8>), String> {
    let mut kind: Option<String> = None;
    let mut name: Option<String> = None;
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| format!("malformed multipart: {e}"))?
    {
        match field.name() {
            Some("kind") => {
                kind = Some(field.text().await.map_err(|e| e.to_string())?);
            }
            Some("file") => {
                // The uploaded filename is what a symbolicator matches
                // on for dSYMs and proguard maps, so it is data, not
                // decoration.
                name = field.file_name().map(str::to_owned);
                let data = field.bytes().await.map_err(|e| e.to_string())?;
                if data.len() > MAX_BYTES {
                    return Err(format!("file exceeds {MAX_BYTES} bytes"));
                }
                bytes = Some(data.to_vec());
            }
            _ => {}
        }
    }

    let kind = kind.ok_or("missing `kind` field")?;
    if !KINDS.contains(&kind.as_str()) {
        return Err(format!("unknown kind {kind:?}; expected one of {KINDS:?}"));
    }
    let bytes = bytes.ok_or("missing `file` field")?;
    if bytes.is_empty() {
        return Err("file is empty".into());
    }
    let name = name.unwrap_or_else(|| format!("{kind}.bin"));
    Ok((kind, name, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A typo in `kind` would store an artifact that never matches
    /// anything, and the upload would look like it worked.
    #[test]
    fn kinds_are_the_ones_a_symbolicator_understands() {
        assert!(KINDS.contains(&"sourcemap"));
        assert!(KINDS.contains(&"dsym"));
        assert!(KINDS.contains(&"proguard"));
        assert!(!KINDS.contains(&"source-map"));
        assert!(!KINDS.contains(&"symbols"));
    }
}
