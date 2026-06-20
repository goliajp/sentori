// Phase 22 sub-A: dSYM upload + listing.
//
// One HTTP request = one Mach-O slice (single (debug_id, arch) pair).
// Client side (the CLI) is responsible for splitting fat dSYMs and
// posting each slice. Body is raw bytes; metadata travels as headers
// to keep the wire format dead-simple — every HTTP client can handle
// `Content-Type: application/octet-stream` without spinning up a
// multipart helper.
//
// Auth: protected by the existing admin router (require_admin +
// require_project_in_org). No additional role gate beyond
// "you can write to the project's tokens" — uploading a dSYM is in
// the same trust class.

use axum::{
    body::Bytes,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::recent::AppState;

/// Hard cap on a single slice. Most production dSYMs run < 50 MB
/// per arch; rejecting > 256 MB protects PG from accidentally being
/// asked to TOAST a 1 GB blob.
const MAX_DSYM_BYTES: usize = 256 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadQuery {
    pub release: Option<String>,
    pub object_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadResponse {
    arch: String,
    debug_id: String,
    id: Uuid,
    size_bytes: i32,
}

/// `POST /admin/api/projects/{project_id}/dsyms`
///
/// Headers:
///   x-sentori-debug-id: 1234ABCD-1234-1234-1234-1234567890AB  (LC_UUID)
///   x-sentori-arch:     arm64 | x86_64 | arm64e | ...
///
/// Query (optional):
///   ?release=myapp@1.2.3+42
///   ?objectName=MyApp
///
/// Body: raw Mach-O DWARF bytes (the file at
/// `Foo.dSYM/Contents/Resources/DWARF/Foo`).
///
/// Idempotent: re-uploading the same (project_id, debug_id, arch)
/// updates the row in place.
pub async fn upload_dsym(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    if body.is_empty() {
        return bad_request("emptyBody");
    }
    if body.len() > MAX_DSYM_BYTES {
        return bad_request("payloadTooLarge");
    }

    let debug_id = match header_str(&headers, "x-sentori-debug-id") {
        Some(s) if is_valid_debug_id(s) => normalise_debug_id(s),
        _ => return bad_request("missingOrInvalidDebugId"),
    };
    let arch = match header_str(&headers, "x-sentori-arch") {
        Some(s) if is_valid_arch(s) => s.to_string(),
        _ => return bad_request("missingOrInvalidArch"),
    };

    let id = Uuid::now_v7();
    let actor = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };

    let res = sqlx::query(
        "INSERT INTO dsyms \
            (id, project_id, release, debug_id, arch, object_name, size_bytes, data, uploaded_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
         ON CONFLICT (project_id, debug_id, arch) DO UPDATE \
         SET release     = EXCLUDED.release, \
             object_name = EXCLUDED.object_name, \
             size_bytes  = EXCLUDED.size_bytes, \
             data        = EXCLUDED.data, \
             uploaded_by = EXCLUDED.uploaded_by, \
             uploaded_at = now()",
    )
    .bind(id)
    .bind(project_id)
    .bind(q.release.as_deref())
    .bind(&debug_id)
    .bind(&arch)
    .bind(q.object_name.as_deref())
    .bind(body.len() as i32)
    .bind(body.as_ref())
    .bind(actor)
    .execute(&pool)
    .await;

    if let Err(e) = res {
        tracing::error!(error = %e, %project_id, %debug_id, %arch, "dsym upload failed");
        return server_error("uploadFailed");
    }

    // Resolve org_id so audit::record can attribute correctly.
    let org_id: Option<Uuid> =
        sqlx::query_scalar("SELECT org_id FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    if let Some(oid) = org_id {
        crate::audit::record(
            &pool,
            oid,
            actor,
            "dsym.uploaded",
            "dsym",
            Some(id),
            json!({
                "project_id": project_id,
                "debug_id":   debug_id,
                "arch":       arch,
                "release":    q.release,
                "size_bytes": body.len(),
            }),
        )
        .await;
    }

    (
        StatusCode::CREATED,
        Json(UploadResponse {
            arch,
            debug_id,
            id,
            size_bytes: body.len() as i32,
        }),
    )
        .into_response()
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct DsymRow {
    id: Uuid,
    debug_id: String,
    arch: String,
    object_name: Option<String>,
    release: Option<String>,
    size_bytes: i32,
    #[serde(with = "time::serde::rfc3339")]
    uploaded_at: OffsetDateTime,
    uploaded_by_email: Option<String>,
}

/// `GET /admin/api/projects/{project_id}/releases/{release}/artifacts`
/// Phase 22 sub-F: unified summary returning every artifact uploaded
/// for a given release — JS sourcemaps + iOS dSYMs + Android mappings.
/// Dashboard release detail page reads this; the per-table list
/// endpoints stay around for narrower views.
pub async fn release_artifacts(
    State(state): State<AppState>,
    Path((project_id, release)): Path<(Uuid, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    #[derive(Serialize, sqlx::FromRow)]
    #[serde(rename_all = "camelCase")]
    struct DsymRow {
        arch: String,
        debug_id: String,
        id: Uuid,
        object_name: Option<String>,
        size_bytes: i32,
        #[serde(with = "time::serde::rfc3339")]
        uploaded_at: OffsetDateTime,
        uploaded_by_email: Option<String>,
    }

    #[derive(Serialize, sqlx::FromRow)]
    #[serde(rename_all = "camelCase")]
    struct MappingRow {
        debug_id: Option<String>,
        id: Uuid,
        size_bytes: i32,
        #[serde(with = "time::serde::rfc3339")]
        uploaded_at: OffsetDateTime,
        uploaded_by_email: Option<String>,
    }

    /// Despite the name, this struct holds *any* release_artifacts
    /// row — sourcemaps, JS bundles, and (post v1.3 W15)
    /// source_bundle_ios / source_bundle_android. The `kind` field
    /// discriminates. The new optional metadata fields are surfaced
    /// for the source-bundle panel; null for legacy rows that
    /// predate W15.
    #[derive(Serialize, sqlx::FromRow)]
    #[serde(rename_all = "camelCase")]
    struct SourcemapRow {
        content_hash: String,
        #[serde(with = "time::serde::rfc3339")]
        created_at: OffsetDateTime,
        entry_count: Option<i32>,
        id: Uuid,
        kind: String,
        // v1.4 W26 — operator-supplied module tag (main / watch-ext /…).
        // None for v1.3 single-bundle and legacy rows.
        module_label: Option<String>,
        name: String,
        uncompressed_size_bytes: Option<i64>,
    }

    let dsyms: Vec<DsymRow> = sqlx::query_as(
        "SELECT d.id, d.debug_id, d.arch, d.object_name, d.size_bytes, \
                d.uploaded_at, u.email AS uploaded_by_email \
         FROM dsyms d LEFT JOIN users u ON u.id = d.uploaded_by \
         WHERE d.project_id = $1 AND d.release = $2 \
         ORDER BY d.uploaded_at DESC",
    )
    .bind(project_id)
    .bind(&release)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mappings: Vec<MappingRow> = sqlx::query_as(
        "SELECT m.id, m.debug_id, m.size_bytes, m.uploaded_at, \
                u.email AS uploaded_by_email \
         FROM proguard_mappings m LEFT JOIN users u ON u.id = m.uploaded_by \
         WHERE m.project_id = $1 AND m.release = $2 \
         ORDER BY m.uploaded_at DESC",
    )
    .bind(project_id)
    .bind(&release)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let sourcemaps: Vec<SourcemapRow> = sqlx::query_as(
        "SELECT ra.id, ra.kind, ra.name, ra.content_hash, ra.created_at, \
                ra.entry_count, ra.uncompressed_size_bytes, ra.module_label \
         FROM release_artifacts ra \
         JOIN releases r ON r.id = ra.release_id \
         WHERE r.project_id = $1 AND r.name = $2 \
         ORDER BY ra.created_at DESC",
    )
    .bind(project_id)
    .bind(&release)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (
        StatusCode::OK,
        Json(json!({
            "release":    release,
            "sourcemaps": sourcemaps,
            "dsyms":      dsyms,
            "mappings":   mappings,
        })),
    )
        .into_response()
}

/// `GET /admin/api/projects/{project_id}/dsyms?release=&limit=`
pub async fn list_dsyms(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let limit = q.limit.unwrap_or(100).clamp(1, 500);

    let rows: Vec<DsymRow> = if let Some(r) = q.release.as_deref() {
        sqlx::query_as(
            "SELECT d.id, d.debug_id, d.arch, d.object_name, d.release, \
                    d.size_bytes, d.uploaded_at, u.email AS uploaded_by_email \
             FROM dsyms d LEFT JOIN users u ON u.id = d.uploaded_by \
             WHERE d.project_id = $1 AND d.release = $2 \
             ORDER BY d.uploaded_at DESC \
             LIMIT $3",
        )
        .bind(project_id)
        .bind(r)
        .bind(limit)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query_as(
            "SELECT d.id, d.debug_id, d.arch, d.object_name, d.release, \
                    d.size_bytes, d.uploaded_at, u.email AS uploaded_by_email \
             FROM dsyms d LEFT JOIN users u ON u.id = d.uploaded_by \
             WHERE d.project_id = $1 \
             ORDER BY d.uploaded_at DESC \
             LIMIT $2",
        )
        .bind(project_id)
        .bind(limit)
        .fetch_all(&pool)
        .await
    }
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub release: Option<String>,
}

// ---------- helpers ----------

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn is_valid_debug_id(s: &str) -> bool {
    // Accept either bare hex (32 chars) or canonical
    // 8-4-4-4-12 dashed form. Reject anything outside hex + dashes.
    let n = s.chars().filter(|c| c.is_ascii_hexdigit()).count();
    if n != 32 {
        return false;
    }
    s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn normalise_debug_id(s: &str) -> String {
    // Canonical lowercase 8-4-4-4-12.
    let hex: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let h = hex.to_ascii_lowercase();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
}

fn is_valid_arch(s: &str) -> bool {
    // Whitelist the architectures atos understands. Anything else is
    // rejected so the upload doesn't sit on disk waiting for a
    // matching crash that'll never come.
    matches!(
        s,
        "arm64"
            | "arm64e"
            | "arm64_32"
            | "armv7"
            | "armv7s"
            | "armv7k"
            | "x86_64"
            | "x86_64h"
            | "i386"
    )
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
