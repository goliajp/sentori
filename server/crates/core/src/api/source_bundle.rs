// v1.2 W3.a — native source-bundle upload.
//
// Companion to dSYM (iOS) and Proguard mapping (Android) uploads:
// dSYM/proguard let the server resolve `PC → file:line`, but neither
// embeds the actual source code. The dashboard's FrameSourceDrawer
// renders inline source for JS frames via `sourcesContent` baked into
// uploaded source maps; for native we need the same affordance, which
// means uploading the project's source tree as a tar.gz archive.
//
// One bundle per (release, platform). Re-uploading replaces.
// release_artifacts row carries kind='source_bundle_ios' or
// 'source_bundle_android', a stable `name = source-bundle-<platform>`
// (so the upsert on (release_id, name) replaces in place), and a
// content_hash + blob_path pair following the same convention as
// sourcemap uploads. The actual tarball lives at
// `<SENTORI_DATA_DIR>/artifacts/<sha256-hex>`.

use std::path::PathBuf;

use axum::{
    body::Bytes,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

/// 64 MB cap. Source bundles for a typical iOS / Android app are
/// 1-10 MB tar.gz'd; 64 MB is generous but blocks accidental "tar
/// my entire monorepo" runs that would gum up uploads.
const MAX_SOURCE_BUNDLE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadQuery {
    pub release: String,
    pub platform: String,
    /// v1.4 W26 — optional module label for multi-bundle uploads.
    /// When set, multiple bundles per (release, platform) coexist
    /// keyed by `source-bundle-<platform>-<module>`. When absent,
    /// behaves like v1.3 W15 (one bundle per platform per release).
    #[serde(default)]
    pub module: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub release_id: Uuid,
    pub kind: String,
    pub content_hash: String,
    pub size_bytes: i64,
}

/// `POST /admin/api/projects/{project_id}/source-bundles?release=<r>&platform=ios|android`
///
/// Body: raw tar.gz bytes.
///
/// Idempotent: re-uploading the same (release, platform) replaces the
/// row (and reuses the blob if content_hash already exists on disk).
pub async fn upload_source_bundle(
    State(state): State<AppState>,
    Extension(_caller): Extension<AdminCaller>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    if body.is_empty() {
        return Err(AppError::Internal("emptyBody".into()));
    }
    if body.len() > MAX_SOURCE_BUNDLE_BYTES {
        return Err(AppError::Internal(format!(
            "payloadTooLarge: {} > {}",
            body.len(),
            MAX_SOURCE_BUNDLE_BYTES
        )));
    }
    let platform = q.platform.as_str();
    if platform != "ios" && platform != "android" {
        return Err(AppError::Internal(format!(
            "platform must be 'ios' or 'android', got '{platform}'"
        )));
    }
    // Light header sniff: tar.gz starts with the gzip magic 1F 8B. We
    // don't fully verify here — the dashboard's source-lookup path
    // does the real work and reports bad archives via 5xx.
    if body.len() < 2 || body[0] != 0x1f || body[1] != 0x8b {
        return Err(AppError::Internal(
            "body does not look like a gzip stream (expected 1f 8b magic)".into(),
        ));
    }

    let release_id = ensure_release(pool, project_id, &q.release).await?;
    let kind = format!("source_bundle_{platform}");
    // v1.4 W26: include module label in name so multi-bundle uploads
    // don't collide. Empty module reads as the v1.3 single-bundle case.
    let module = q
        .module
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let name = match module.as_deref() {
        Some(m) => format!("source-bundle-{platform}-{m}"),
        None => format!("source-bundle-{platform}"),
    };
    let hash = format!("{:x}", Sha256::digest(&body));

    // v1.3 W15 — compute denormalised stats at upload time so the
    // dashboard panel can render "n files · M MB" without re-
    // extracting on every page load.
    let stats = crate::source_bundle::stats_for(&body)
        .map_err(|e| AppError::Internal(format!("bundle stats: {e}")))?;

    let data_dir = std::env::var("SENTORI_DATA_DIR").unwrap_or_else(|_| "./data".to_string());
    let blob_dir = PathBuf::from(&data_dir).join("artifacts");
    tokio::fs::create_dir_all(&blob_dir)
        .await
        .map_err(|e| AppError::Internal(format!("create artifact dir: {e}")))?;
    let path = blob_dir.join(&hash);
    if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
        tokio::fs::write(&path, &body)
            .await
            .map_err(|e| AppError::Internal(format!("write blob: {e}")))?;
    }

    sqlx::query(
        r#"
        INSERT INTO release_artifacts
            (id, release_id, kind, name, content_hash, blob_path,
             entry_count, uncompressed_size_bytes, module_label)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (release_id, name) DO UPDATE SET
            content_hash             = EXCLUDED.content_hash,
            blob_path                = EXCLUDED.blob_path,
            kind                     = EXCLUDED.kind,
            entry_count              = EXCLUDED.entry_count,
            uncompressed_size_bytes  = EXCLUDED.uncompressed_size_bytes,
            module_label             = EXCLUDED.module_label
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(release_id)
    .bind(&kind)
    .bind(&name)
    .bind(&hash)
    .bind(path.to_string_lossy().as_ref())
    .bind(stats.entry_count)
    .bind(stats.uncompressed_size_bytes)
    .bind(module.as_deref())
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("insert artifact: {e}")))?;

    Ok((
        StatusCode::CREATED,
        Json(UploadResponse {
            content_hash: hash,
            kind,
            release_id,
            size_bytes: body.len() as i64,
        }),
    )
        .into_response())
}

async fn ensure_release(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    name: &str,
) -> Result<Uuid, AppError> {
    let id: Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO releases (id, project_id, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(project_id)
    .bind(name)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(format!("ensure release: {e}")))?;
    Ok(id)
}

/// v1.3 W15: `DELETE /admin/api/projects/{p}/releases/{r}/artifacts/{id}`.
///
/// Removes one release_artifacts row + tries best-effort to unlink
/// the underlying blob file when no other row references it. Used
/// by the dashboard "Uploaded source bundles" panel.
pub async fn delete_release_artifact(
    State(state): State<AppState>,
    Extension(_caller): Extension<AdminCaller>,
    Path((project_id, release_name, artifact_id)): Path<(Uuid, String, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    // Authorise scope: artifact must belong to a release in the
    // caller's project. The middleware already gates project_id;
    // we additionally verify the release_name matches.
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT ra.blob_path, ra.content_hash \
         FROM release_artifacts ra \
         JOIN releases r ON r.id = ra.release_id \
         WHERE ra.id = $1 AND r.project_id = $2 AND r.name = $3",
    )
    .bind(artifact_id)
    .bind(project_id)
    .bind(&release_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("lookup artifact: {e}")))?;
    let Some((blob_path, content_hash)) = row else {
        return Err(AppError::NotFound);
    };

    sqlx::query("DELETE FROM release_artifacts WHERE id = $1")
        .bind(artifact_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("delete artifact: {e}")))?;

    // Best-effort blob cleanup. The artifacts blob is dedup-by-
    // content_hash across the entire instance; only unlink when no
    // other row references the same hash.
    let still_referenced: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM release_artifacts WHERE content_hash = $1",
    )
    .bind(&content_hash)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("count refs: {e}")))?;
    if let Some((n,)) = still_referenced {
        if n == 0 {
            let _ = tokio::fs::remove_file(&blob_path).await;
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}
