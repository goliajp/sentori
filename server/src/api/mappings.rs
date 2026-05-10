// Phase 22 sub-C: Android ProGuard / R8 mapping upload + listing.
//
// Mappings are plain text but routinely 10–50 MB on big apps; we
// store as bytea and let PG TOAST. The endpoint follows the same
// header-driven shape as the dSYM endpoint (sub-A) so the CLI can
// reuse most of its plumbing — single text/octet-stream POST,
// metadata in headers + query.
//
// Auth + body limits inherit the admin router's project-access
// middleware and the per-route 256 MB cap.

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

const MAX_MAPPING_BYTES: usize = 256 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadQuery {
    pub release: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadResponse {
    debug_id: Option<String>,
    id: Uuid,
    size_bytes: i32,
}

/// `POST /admin/api/projects/{project_id}/mappings`
///
/// Headers (optional):
///   x-sentori-debug-id: <uuid>   # the R8 mapping's "uuid" header line,
///                                # if present. Falls back to release.
///
/// Query (optional):
///   ?release=myapp@1.2.3+42
///
/// Body: raw bytes of mapping.txt.
///
/// On insert we always create a new row — proguard mappings are tiny
/// relative to dSYMs and tracking history per build is useful when
/// debugging a regression. The retracer (symbolicate_android.rs)
/// resolves frames via the latest matching mapping.
pub async fn upload_mapping(
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
    if body.len() > MAX_MAPPING_BYTES {
        return bad_request("payloadTooLarge");
    }

    // debug_id: prefer the explicit header, otherwise sniff the
    // "# pg_map_id" line R8 emits at the top of mapping.txt.
    let debug_id = headers
        .get("x-sentori-debug-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .or_else(|| sniff_pg_map_id(body.as_ref()));

    let id = Uuid::now_v7();
    let actor = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };

    let res = sqlx::query(
        "INSERT INTO proguard_mappings \
            (id, project_id, release, debug_id, size_bytes, data, uploaded_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(project_id)
    .bind(q.release.as_deref())
    .bind(debug_id.as_deref())
    .bind(body.len() as i32)
    .bind(body.as_ref())
    .bind(actor)
    .execute(&pool)
    .await;

    if let Err(e) = res {
        tracing::error!(error = %e, %project_id, ?debug_id, "proguard upload failed");
        return server_error("uploadFailed");
    }

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
            "proguard.uploaded",
            "proguard_mapping",
            Some(id),
            json!({
                "project_id": project_id,
                "debug_id":   debug_id,
                "release":    q.release,
                "size_bytes": body.len(),
            }),
        )
        .await;
    }

    (
        StatusCode::CREATED,
        Json(UploadResponse {
            debug_id,
            id,
            size_bytes: body.len() as i32,
        }),
    )
        .into_response()
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct MappingRow {
    id: Uuid,
    debug_id: Option<String>,
    release: Option<String>,
    size_bytes: i32,
    uploaded_at: OffsetDateTime,
    uploaded_by_email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub release: Option<String>,
}

/// `GET /admin/api/projects/{project_id}/mappings?release=&limit=`
pub async fn list_mappings(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let limit = q.limit.unwrap_or(100).clamp(1, 500);

    let rows: Vec<MappingRow> = if let Some(r) = q.release.as_deref() {
        sqlx::query_as(
            "SELECT m.id, m.debug_id, m.release, m.size_bytes, m.uploaded_at, \
                    u.email AS uploaded_by_email \
             FROM proguard_mappings m LEFT JOIN users u ON u.id = m.uploaded_by \
             WHERE m.project_id = $1 AND m.release = $2 \
             ORDER BY m.uploaded_at DESC \
             LIMIT $3",
        )
        .bind(project_id)
        .bind(r)
        .bind(limit)
        .fetch_all(&pool)
        .await
    } else {
        sqlx::query_as(
            "SELECT m.id, m.debug_id, m.release, m.size_bytes, m.uploaded_at, \
                    u.email AS uploaded_by_email \
             FROM proguard_mappings m LEFT JOIN users u ON u.id = m.uploaded_by \
             WHERE m.project_id = $1 \
             ORDER BY m.uploaded_at DESC \
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

/// R8 emits `# pg_map_id: <hex>` near the top of mapping.txt. Returns
/// the captured value or None if the prefix isn't present in the
/// first 4 KB.
fn sniff_pg_map_id(bytes: &[u8]) -> Option<String> {
    let prefix = bytes.iter().take(4096).copied().collect::<Vec<_>>();
    let head = std::str::from_utf8(&prefix).ok()?;
    for line in head.lines() {
        let line = line.trim_start();
        if let Some(rest) = line
            .strip_prefix("# pg_map_id:")
            .or_else(|| line.strip_prefix("# Build-id:"))
        {
            let id = rest.trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
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
