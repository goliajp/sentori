// Source-map status summary per project — drives the dashboard banner
// that tells operators "you have N releases but zero sourcemaps
// uploaded, that's why click-to-source returns nothing."
//
// v1.2 W2: counterpart to the per-release `releases.rs` listing.
// Single roundtrip aggregate so the issue-detail page can decide
// whether to show the banner without N per-release queries.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

/// v1.4 W27 — per-event source-coverage.
///
/// `GET /admin/api/projects/{p}/releases/{r}/source-coverage`
/// Returns `{ hasJsSourcemap, hasIosBundle, hasAndroidBundle }`
/// scoped to the release. The dashboard's FrameRow / banner uses
/// this to render the exact "no source" hint that matches the
/// event's release, replacing v1.2 W2.b's file-extension heuristic.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCoverageResponse {
    pub has_js_sourcemap: bool,
    pub has_ios_bundle: bool,
    pub has_android_bundle: bool,
}

pub async fn source_coverage(
    State(state): State<AppState>,
    Path((project_id, release_name)): Path<(Uuid, String)>,
) -> Result<Json<SourceCoverageResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let row: Option<(bool, bool, bool)> = sqlx::query_as(
        r#"
        SELECT
            EXISTS (
                SELECT 1 FROM release_artifacts ra
                JOIN releases r ON r.id = ra.release_id
                WHERE r.project_id = $1 AND r.name = $2 AND ra.kind = 'sourcemap'
            ) AS has_js,
            EXISTS (
                SELECT 1 FROM release_artifacts ra
                JOIN releases r ON r.id = ra.release_id
                WHERE r.project_id = $1 AND r.name = $2 AND ra.kind = 'source_bundle_ios'
            ) AS has_ios,
            EXISTS (
                SELECT 1 FROM release_artifacts ra
                JOIN releases r ON r.id = ra.release_id
                WHERE r.project_id = $1 AND r.name = $2 AND ra.kind = 'source_bundle_android'
            ) AS has_android
        "#,
    )
    .bind(project_id)
    .bind(&release_name)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("source_coverage: {e}")))?;
    let (has_js, has_ios, has_android) = row.unwrap_or((false, false, false));
    Ok(Json(SourceCoverageResponse {
        has_js_sourcemap: has_js,
        has_ios_bundle: has_ios,
        has_android_bundle: has_android,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcemapStatusResponse {
    /// Total number of releases registered for the project.
    pub releases_total: i64,
    /// Releases with at least one `release_artifacts.kind='sourcemap'`.
    pub releases_with_sourcemap: i64,
    /// Most recent sourcemap upload time across the project. `None` if
    /// no sourcemaps uploaded yet.
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_uploaded_at: Option<OffsetDateTime>,
    /// v1.2 W3.c — number of releases with at least one
    /// `source_bundle_ios` artifact uploaded.
    pub releases_with_ios_bundle: i64,
    /// v1.2 W3.c — same for Android (`source_bundle_android`).
    pub releases_with_android_bundle: i64,
}

pub async fn sourcemap_status(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<SourcemapStatusResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    let row: (i64, i64, Option<OffsetDateTime>, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(DISTINCT r.id)::bigint AS releases_total,
            COUNT(DISTINCT r.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM release_artifacts ra
                    WHERE ra.release_id = r.id AND ra.kind = 'sourcemap'
                )
            )::bigint AS releases_with_sourcemap,
            (
                SELECT MAX(ra.created_at)
                FROM release_artifacts ra
                JOIN releases r2 ON r2.id = ra.release_id
                WHERE r2.project_id = $1 AND ra.kind = 'sourcemap'
            ) AS last_uploaded_at,
            COUNT(DISTINCT r.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM release_artifacts ra
                    WHERE ra.release_id = r.id AND ra.kind = 'source_bundle_ios'
                )
            )::bigint AS releases_with_ios_bundle,
            COUNT(DISTINCT r.id) FILTER (
                WHERE EXISTS (
                    SELECT 1 FROM release_artifacts ra
                    WHERE ra.release_id = r.id AND ra.kind = 'source_bundle_android'
                )
            )::bigint AS releases_with_android_bundle
        FROM releases r
        WHERE r.project_id = $1
        "#,
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(format!("sourcemap_status: {e}")))?;

    Ok(Json(SourcemapStatusResponse {
        last_uploaded_at: row.2,
        releases_total: row.0,
        releases_with_android_bundle: row.4,
        releases_with_ios_bundle: row.3,
        releases_with_sourcemap: row.1,
    }))
}
