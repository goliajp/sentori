// Phase 42 sub-C.04/06 — event-attachment ingest + admin fetch.
//
// Two endpoints:
//
//   POST /v1/events/{event_id}/attachments/{kind}   (ingest token auth)
//   GET  /admin/api/events/{event_id}/attachments/{ref}   (admin session)
//
// Flow:
//   1. SDK builds `event.id = uuidV7()`.
//   2. If the event has an attachment, SDK POSTs the blob to the
//      ingest endpoint first → server stores it + returns `{ref}`.
//   3. SDK POSTs the event JSON with `attachments: [{ ref, kind, ... }]`.
//   4. Event-ingest validates that every ref's `(event_id, project_id)`
//      matches the incoming event (sub-C.05; lives in events.rs).
//
// The upload endpoint is rate-limited via the same `require_token`
// middleware as `/v1/events`; the 500 KB per-part body limit is the
// hard cap on attachment size.

use axum::{
    extract::{Extension, Multipart, Path, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::api::events::caller_project_id;
use crate::attachments::AttachmentError;
use crate::auth::IngestCaller;
use crate::recent::AppState;

const MAX_ATTACHMENT_BYTES: usize = 500 * 1024;
const ALLOWED_KINDS: &[&str] = &[
    "screenshot",
    "viewTree",
    "stateSnapshot",
    "logTail",
    "sessionTrail",
    // v0.9.13 — wireframe replay ring drained on captureException.
    // The DB CHECK constraint was widened in migration
    // 0043_attachments_replay_kind.sql, but the application-level
    // whitelist here was never updated, so every replay upload was
    // 400 invalidKind on the server side. That's the Insight-side
    // "○ replay" empty-circle outcome on dashboard event headers.
    "replay",
];
const ALLOWED_SOURCES: &[&str] = &["js", "ios", "android"];

/// Per-kind media-type whitelist. Screenshots are images, the JSON
/// kinds are application/json — preventing e.g. an HTML payload
/// reaching the dashboard via the `viewTree` slot.
fn allowed_media_types(kind: &str) -> &'static [&'static str] {
    match kind {
        "screenshot" => &["image/webp", "image/png", "image/jpeg"],
        "viewTree" | "stateSnapshot" | "sessionTrail" => &["application/json"],
        "logTail" => &["application/json", "text/plain"],
        "replay" => &["application/x-ndjson", "application/json"],
        _ => &[],
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub ref_id: Uuid,
    pub size_bytes: i32,
    pub media_type: String,
    pub kind: String,
}

/// `POST /v1/events/{event_id}/attachments/{kind}` — multipart upload.
///
/// The multipart body must contain a single file field whose
/// `Content-Type` falls under `allowed_media_types(kind)`. Bigger
/// than 500 KB → 413. Unknown kind → 400.
pub async fn upload(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Path((event_id, kind)): Path<(Uuid, String)>,
    multipart: Multipart,
) -> Response {
    if !ALLOWED_KINDS.contains(&kind.as_str()) {
        tracing::warn!(%event_id, %kind, "attachment upload rejected: invalidKind");
        return bad_request("invalidKind");
    }

    let project_id = caller_project_id(&caller, &state);

    let parsed = match read_one_part(multipart, &kind).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(
                %event_id, %project_id, %kind,
                "attachment upload rejected: multipart parse / size / media-type",
            );
            return e;
        }
    };

    // Hand the blob to the store. Disabled store returns 503 so the
    // SDK can fall back cleanly without losing the rest of the event.
    if let Err(e) = state
        .attachments
        .put(project_id, event_id, parsed.ref_id, &parsed.data)
        .await
    {
        return match e {
            AttachmentError::Disabled => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "attachmentsDisabled" })),
            )
                .into_response(),
            other => {
                tracing::error!(error = %other, %event_id, %project_id, %kind, "attachment put failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "storeFailure" })),
                )
                    .into_response()
            }
        };
    }

    // Persist metadata. If the INSERT fails, roll back the blob.
    let Some(pool) = state.db.as_ref() else {
        let _ = state
            .attachments
            .delete(project_id, event_id, parsed.ref_id)
            .await;
        return server_error("dbNotConfigured");
    };

    let now = time::OffsetDateTime::now_utc();
    let res = sqlx::query(
        r#"
        INSERT INTO event_attachments
            (ref, event_id, project_id, kind, media_type, size_bytes,
             captured_at, source, received_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(parsed.ref_id)
    .bind(event_id)
    .bind(project_id)
    .bind(&kind)
    .bind(&parsed.media_type)
    .bind(parsed.data.len() as i32)
    .bind(parsed.captured_at.unwrap_or(now))
    .bind(parsed.source.unwrap_or_else(|| "js".to_string()))
    .bind(now)
    .execute(pool)
    .await;

    if let Err(e) = res {
        tracing::error!(error = %e, %event_id, %project_id, %kind, "event_attachments insert failed");
        let _ = state
            .attachments
            .delete(project_id, event_id, parsed.ref_id)
            .await;
        return server_error("dbError");
    }

    tracing::info!(
        %event_id, %project_id, kind = %kind,
        ref_id = %parsed.ref_id,
        size_bytes = parsed.data.len(),
        "attachment upload ok",
    );

    (
        StatusCode::CREATED,
        Json(UploadResponse {
            ref_id: parsed.ref_id,
            size_bytes: parsed.data.len() as i32,
            media_type: parsed.media_type,
            kind,
        }),
    )
        .into_response()
}

/// `GET /admin/api/events/{event_id}/attachments/{ref}`
///
/// Returns the blob with the stored media-type. Access is gated by
/// admin session over a project that owns the event (matching by
/// `event_attachments.project_id`).
pub async fn fetch(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((event_id, ref_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };

    // Look up the attachment + its project. A DB error must
    // fail-closed: returning `None` here would treat a transient SQL
    // failure as "row not found" and proceed past auth — silently
    // letting anyone hit the blob in the worst case. 500 instead.
    let row_res = sqlx::query_as::<_, (Uuid, String, String, i32)>(
        r#"
        SELECT project_id, kind, media_type, size_bytes
        FROM event_attachments
        WHERE ref = $1 AND event_id = $2
        "#,
    )
    .bind(ref_id)
    .bind(event_id)
    .fetch_optional(pool)
    .await;
    let row = match row_res {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "attachments.fetch: db query failed");
            return server_error("dbError");
        }
    };

    let Some((project_id, _kind, media_type, _size)) = row else {
        return not_found("attachmentNotFound");
    };

    // Admin gate: caller must have a membership in the project's org.
    // Super-admin / dev token bypass the membership check.
    if !is_admin_for_project(pool, &caller, project_id).await {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "forbidden" })),
        )
            .into_response();
    }

    let data = match state.attachments.get(project_id, event_id, ref_id).await {
        Ok(d) => d,
        Err(AttachmentError::NotFound) => return not_found("blobMissing"),
        Err(e) => {
            tracing::error!(error = %e, "attachment get failed");
            return server_error("storeFailure");
        }
    };

    // Build the response with the right Content-Type.
    let mut response = (StatusCode::OK, data).into_response();
    if let Ok(v) = HeaderValue::from_str(&media_type) {
        response.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600, immutable"),
    );
    response
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRow {
    pub r#ref: Uuid,
    pub kind: String,
    pub media_type: String,
    pub size_bytes: i32,
    pub source: String,
}

/// Phase 48 sub-A.2 — `GET /admin/api/projects/{project_id}/events/{event_id}/attachments`
///
/// Lists every attachment row the server has for an event, regardless
/// of whether `payload.attachments[]` in the event JSON echoed them.
/// Dashboard pulls from this so a broken client-side echo (the
/// 201→202 rewrite Insight reported) can't hide the screenshot.
///
/// Scoped under `/projects/{project_id}/` so `require_project_in_org`
/// middleware gates access and the SQL query can use the
/// `(project_id, event_id)` filter directly — a naked `WHERE id = $1`
/// on the events table forces a sequential scan of every monthly
/// partition.
pub async fn list_for_event(
    State(state): State<AppState>,
    Path((project_id, event_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };

    let rows: Vec<AttachmentRow> = match sqlx::query_as(
        r#"
        SELECT ref, kind, media_type, size_bytes, source
        FROM event_attachments
        WHERE project_id = $1 AND event_id = $2
        ORDER BY received_at ASC
        "#,
    )
    .bind(project_id)
    .bind(event_id)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, %project_id, %event_id, "list_for_event query failed");
            return server_error("dbError");
        }
    };

    (StatusCode::OK, Json(rows)).into_response()
}

/// `GET /admin/api/projects/{project_id}/events/{event_id}/replay-frames`
///
/// Dashboard Replay-tab read path (v1.0 A3). Returns the parsed
/// frames from the **latest** replay-kind attachment for the event,
/// so the scrubber can render a timeline without doing
/// NDJSON-parsing on the client.
///
/// Multiple replay attachments per event are rare (one per
/// captureException by design) but if they happen, we surface the
/// most recently received one — that's the frame stream that led
/// up to the current event.
///
/// Response shape:
/// ```json
/// {
///   "ref": "uuid",
///   "frameCount": 42,
///   "frames": [
///     { "ts": 17338..., "width": 390, "height": 844, "nodes": [...] },
///     ...
///   ]
/// }
/// ```
/// 200 with `frames: []` when the event has no replay attachment —
/// keeps the dashboard rendering pattern simple (no special 404
/// branch for "feature absent").
pub async fn replay_frames(
    State(state): State<AppState>,
    Path((project_id, event_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };

    let row_res = sqlx::query_as::<_, (Uuid,)>(
        r#"
        SELECT ref
        FROM event_attachments
        WHERE project_id = $1 AND event_id = $2 AND kind = 'replay'
        ORDER BY received_at DESC
        LIMIT 1
        "#,
    )
    .bind(project_id)
    .bind(event_id)
    .fetch_optional(pool)
    .await;
    let row = match row_res {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, %project_id, %event_id, "replay_frames query failed");
            return server_error("dbError");
        }
    };

    let Some((ref_id,)) = row else {
        // No replay attachment — return an empty stream, not 404.
        return (
            StatusCode::OK,
            Json(json!({ "ref": null, "frameCount": 0, "frames": [] })),
        )
            .into_response();
    };

    let data = match state.attachments.get(project_id, event_id, ref_id).await {
        Ok(d) => d,
        Err(AttachmentError::NotFound) => return not_found("blobMissing"),
        Err(e) => {
            tracing::error!(error = %e, %ref_id, "replay attachment get failed");
            return server_error("storeFailure");
        }
    };

    // NDJSON: one JSON object per line. Skip blank lines + lines
    // that fail to parse — a malformed frame shouldn't break the
    // whole stream.
    let text = match std::str::from_utf8(&data) {
        Ok(t) => t,
        Err(_) => return server_error("notUtf8"),
    };
    let frames = parse_replay_ndjson(text, Some(ref_id));

    (
        StatusCode::OK,
        Json(json!({
            "ref": ref_id,
            "frameCount": frames.len(),
            "frames": frames,
        })),
    )
        .into_response()
}

/// Parse a NDJSON replay attachment into a `Vec<JSON>`. Blank lines
/// are skipped silently; malformed JSON lines are skipped with a
/// `tracing::warn!` so a corrupted single frame can't break the
/// whole timeline.
///
/// `ref_id` is only used for the warn tag (and only when supplied),
/// so the function is callable from tests that don't have a real ref.
pub fn parse_replay_ndjson(text: &str, ref_id: Option<Uuid>) -> Vec<serde_json::Value> {
    let mut frames: Vec<serde_json::Value> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => frames.push(v),
            Err(e) => {
                if let Some(rid) = ref_id {
                    tracing::warn!(error = %e, ref_id = %rid, "replay frame skipped (parse failed)");
                } else {
                    tracing::warn!(error = %e, "replay frame skipped (parse failed)");
                }
            }
        }
    }
    frames
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_string_returns_empty_vec() {
        assert!(parse_replay_ndjson("", None).is_empty());
    }

    #[test]
    fn parse_skips_blank_lines() {
        let input = "\n\n  \n\n";
        assert!(parse_replay_ndjson(input, None).is_empty());
    }

    #[test]
    fn parse_two_well_formed_frames() {
        let input = concat!(
            r#"{"ts":1000,"width":390,"height":844,"nodes":[]}"#,
            "\n",
            r#"{"ts":1500,"width":390,"height":844,"nodes":[{"kind":"text","x":0,"y":0,"w":10,"h":10,"text":"hi"}]}"#,
        );
        let frames = parse_replay_ndjson(input, None);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["ts"], 1000);
        assert_eq!(frames[1]["ts"], 1500);
        assert_eq!(frames[1]["nodes"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn parse_skips_malformed_line_keeps_the_rest() {
        let input = "{\"ts\":1,\"width\":1,\"height\":1,\"nodes\":[]}\n\
                     not json at all\n\
                     {\"ts\":2,\"width\":1,\"height\":1,\"nodes\":[]}\n";
        let frames = parse_replay_ndjson(input, None);
        assert_eq!(frames.len(), 2, "malformed line must not break the timeline");
        assert_eq!(frames[0]["ts"], 1);
        assert_eq!(frames[1]["ts"], 2);
    }

    #[test]
    fn parse_one_frame_no_trailing_newline() {
        let input = r#"{"ts":42,"width":390,"height":844,"nodes":[]}"#;
        let frames = parse_replay_ndjson(input, None);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0]["ts"], 42);
    }
}

async fn is_admin_for_project(
    pool: &sqlx::PgPool,
    caller: &AdminCaller,
    project_id: Uuid,
) -> bool {
    match caller {
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => true,
        AdminCaller::User { id, .. } => {
            // Fail-closed on DB error. A transient SQL failure must
            // *not* be treated as "no row" — that would silently grant
            // the request when membership lookup just timed out.
            //
            // Insight 2026-05-17 Finding 5: this function used
            // `query_as::<_, (i64,)>("SELECT 1 FROM ...")`. PostgreSQL
            // returns `1` as int4 (i32), not int8 (i64), so sqlx
            // raised a column-type-mismatch error and the fail-closed
            // branch returned false for EVERY logged-in user. The
            // first POST upload that actually landed an
            // `event_attachments` row exposed it (before the Finding 3
            // fix, POST returned 503 attachmentsDisabled and this
            // path was unreachable).
            //
            // Decoding the role string from the same memberships join
            // that `require_project_in_org` already uses gives us a
            // type-stable column and parity with the issue-page
            // authorization check.
            let row_res = sqlx::query_scalar::<_, String>(
                "SELECT m.role FROM memberships m \
                 JOIN projects p ON p.org_id = m.org_id \
                 WHERE m.user_id = $1 AND p.id = $2 \
                 LIMIT 1",
            )
            .bind(id)
            .bind(project_id)
            .fetch_optional(pool)
            .await;
            match row_res {
                Ok(Some(_role)) => true,
                Ok(None) => false,
                Err(e) => {
                    tracing::error!(
                        error = %e,
                        user_id = %id,
                        project_id = %project_id,
                        "is_admin_for_project: membership lookup failed; denying",
                    );
                    false
                }
            }
        }
    }
}

// ───────────────────── multipart parsing helpers ──────────────────────

struct ParsedPart {
    ref_id: Uuid,
    data: Vec<u8>,
    media_type: String,
    source: Option<String>,
    captured_at: Option<time::OffsetDateTime>,
}

async fn read_one_part(mut multipart: Multipart, kind: &str) -> Result<ParsedPart, Response> {
    let mut data: Option<Vec<u8>> = None;
    let mut media_type: Option<String> = None;
    let mut source: Option<String> = None;
    let mut captured_at: Option<time::OffsetDateTime> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(error = %e, "multipart parse error");
        bad_request("multipartParse")
    })? {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                let ct = field.content_type().map(|s| s.to_string());
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| bad_request("readPart"))?;
                if bytes.len() > MAX_ATTACHMENT_BYTES {
                    return Err((
                        StatusCode::PAYLOAD_TOO_LARGE,
                        Json(json!({
                            "error": "tooLarge",
                            "maxBytes": MAX_ATTACHMENT_BYTES,
                        })),
                    )
                        .into_response());
                }
                let mt = ct.unwrap_or_else(|| "application/octet-stream".to_string());
                if !allowed_media_types(kind).contains(&mt.as_str()) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        Json(json!({
                            "error": "unsupportedMediaType",
                            "got": mt,
                            "allowed": allowed_media_types(kind),
                        })),
                    )
                        .into_response());
                }
                data = Some(bytes.to_vec());
                media_type = Some(mt);
            }
            "source" => {
                let v = field.text().await.map_err(|_| bad_request("readSource"))?;
                if !ALLOWED_SOURCES.contains(&v.as_str()) {
                    return Err(bad_request("invalidSource"));
                }
                source = Some(v);
            }
            "capturedAt" => {
                let v = field.text().await.map_err(|_| bad_request("readCapturedAt"))?;
                let ts = time::OffsetDateTime::parse(
                    &v,
                    &time::format_description::well_known::Rfc3339,
                )
                .map_err(|_| bad_request("invalidCapturedAt"))?;
                captured_at = Some(ts);
            }
            _ => {
                // Drain unknown fields without storing them.
                let _ = field.bytes().await;
            }
        }
    }

    let data = data.ok_or_else(|| bad_request("missingFile"))?;
    let media_type = media_type.expect("set when data is set");
    Ok(ParsedPart {
        ref_id: Uuid::now_v7(),
        data,
        media_type,
        source,
        captured_at,
    })
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}
fn not_found(error: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": error }))).into_response()
}
fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
