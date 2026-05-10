use std::path::PathBuf;

use axum::{
    extract::{Json, Multipart, Path, Query, State},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResponse {
    pub release_id: Uuid,
    pub uploaded: u32,
    pub artifacts: Vec<UploadedArtifact>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedArtifact {
    pub name: String,
    pub kind: String,
    pub content_hash: String,
}

/// `GET /admin/api/projects/{project_id}/releases`
///
/// Phase 23 sub-A: list releases for a project, enriched with the
/// counts that drive the release card UI: events / sourcemaps /
/// dsyms / mappings, plus first/last seen timestamps. Aggregates
/// happen live — we expect ≤ 1k releases per project for v0.2 and
/// the JOINs are cheap. Sub-D's regression detection adds another
/// column when it lands.
#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRow {
    /// `time::OffsetDateTime` defaults to a 9-element array on the
    /// wire, which breaks `new Date(...)` on the dashboard side.
    /// We annotate every datetime as RFC 3339 strings here. The rest
    /// of the codebase still uses the array default — Phase 28
    /// polish has a single sweep on the agenda.
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: time::OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub deploy_at: Option<time::OffsetDateTime>,
    pub dsym_count: i64,
    pub event_count: i64,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub first_seen: Option<time::OffsetDateTime>,
    pub id: Uuid,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub last_seen: Option<time::OffsetDateTime>,
    pub mapping_count: i64,
    pub name: String,
    pub sourcemap_count: i64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListReleasesQuery {
    pub limit: Option<i64>,
}

pub async fn list_releases(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListReleasesQuery>,
) -> Result<Json<Vec<ReleaseRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);

    let rows: Vec<ReleaseRow> = sqlx::query_as(
        r#"
        SELECT
            r.id,
            r.name,
            r.created_at,
            r.deploy_at,
            COALESCE(ev.event_count, 0)::bigint AS event_count,
            ev.first_seen,
            ev.last_seen,
            COALESCE(am.sourcemap_count, 0)::bigint AS sourcemap_count,
            COALESCE(ds.dsym_count, 0)::bigint AS dsym_count,
            COALESCE(pg.mapping_count, 0)::bigint AS mapping_count
        FROM releases r
        LEFT JOIN (
            SELECT release_id,
                   COUNT(*) AS event_count,
                   MIN(received_at) AS first_seen,
                   MAX(received_at) AS last_seen
            FROM events
            WHERE project_id = $1 AND release_id IS NOT NULL
            GROUP BY release_id
        ) ev ON ev.release_id = r.id
        LEFT JOIN (
            SELECT release_id,
                   COUNT(*) FILTER (WHERE kind = 'sourcemap') AS sourcemap_count
            FROM release_artifacts
            GROUP BY release_id
        ) am ON am.release_id = r.id
        LEFT JOIN (
            SELECT release, COUNT(*) AS dsym_count
            FROM dsyms WHERE project_id = $1
            GROUP BY release
        ) ds ON ds.release = r.name
        LEFT JOIN (
            SELECT release, COUNT(*) AS mapping_count
            FROM proguard_mappings WHERE project_id = $1
            GROUP BY release
        ) pg ON pg.release = r.name
        WHERE r.project_id = $1
        ORDER BY COALESCE(r.deploy_at, r.created_at) DESC
        LIMIT $2
        "#,
    )
    .bind(project_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("list releases: {e}")))?;

    Ok(Json(rows))
}

/// `POST /admin/api/releases/{release_name}/sourcemaps`
///
/// multipart/form-data upload. Each part is a single artifact file.
/// `.js.map` → kind `sourcemap`; `.js` → kind `js`; anything else → `other`.
/// Bodies are stored under `<SENTORI_DATA_DIR>/artifacts/<sha256-hex>` and
/// dedup by content hash; if the file is already present, we just update
/// the `release_artifacts` row.
pub async fn upload_sourcemaps(
    State(state): State<AppState>,
    Path(release_name): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    let release_id = ensure_release(pool, state.project_id, &release_name).await?;

    let data_dir = std::env::var("SENTORI_DATA_DIR").unwrap_or_else(|_| "./data".to_string());
    let blob_dir = PathBuf::from(&data_dir).join("artifacts");
    tokio::fs::create_dir_all(&blob_dir)
        .await
        .map_err(|e| AppError::Internal(format!("create artifact dir: {e}")))?;

    let mut uploaded = 0u32;
    let mut artifacts = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Internal(format!("multipart: {e}")))?
    {
        let name = field
            .file_name()
            .map(|s| s.to_string())
            .or_else(|| field.name().map(|s| s.to_string()))
            .unwrap_or_else(|| "unknown".to_string());
        let kind = classify(&name);

        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::Internal(format!("read part: {e}")))?;

        let hash = format!("{:x}", Sha256::digest(&bytes));
        let path = blob_dir.join(&hash);
        if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
            tokio::fs::write(&path, &bytes)
                .await
                .map_err(|e| AppError::Internal(format!("write blob: {e}")))?;
        }

        sqlx::query(
            r#"
            INSERT INTO release_artifacts
                (id, release_id, kind, name, content_hash, blob_path)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (release_id, name) DO UPDATE SET
                content_hash = EXCLUDED.content_hash,
                blob_path    = EXCLUDED.blob_path,
                kind         = EXCLUDED.kind
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(release_id)
        .bind(kind)
        .bind(&name)
        .bind(&hash)
        .bind(path.to_string_lossy().as_ref())
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("insert artifact: {e}")))?;

        artifacts.push(UploadedArtifact {
            name,
            kind: kind.to_string(),
            content_hash: hash,
        });
        uploaded += 1;
    }

    Ok(Json(UploadResponse {
        release_id,
        uploaded,
        artifacts,
    }))
}

fn classify(name: &str) -> &'static str {
    if name.ends_with(".js.map") {
        "sourcemap"
    } else if name.ends_with(".js") {
        "js"
    } else if name.ends_with(".dSYM") || name.ends_with(".dsym") {
        "dsym"
    } else if name.ends_with("mapping.txt") || name.contains("proguard") {
        "proguard"
    } else {
        "other"
    }
}

async fn ensure_release(
    pool: &PgPool,
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
