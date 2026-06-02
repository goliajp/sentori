// Frame source preview — stack-frame source-line lookup.
//
// v1.1 P2 split-out of `api/admin.rs`.

use axum::{
    extract::{Json, Path, Query, State},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{CAUSE_CHAIN_MAX, FRAME_SOURCE_CONTEXT_LINES_DEFAULT, FRAME_SOURCE_CONTEXT_LINES_MAX};
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSourceQuery {
    pub frame: usize,
    #[serde(default)]
    pub cause: usize,
    #[serde(default)]
    pub lines: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSourceResponse {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub before: Vec<String>,
    pub at: String,
    pub after: Vec<String>,
}

pub async fn frame_source(
    State(state): State<AppState>,
    Path((project_id, event_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<FrameSourceQuery>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    if q.cause > CAUSE_CHAIN_MAX {
        return Err(AppError::Internal(format!(
            "cause depth {} > {}",
            q.cause, CAUSE_CHAIN_MAX
        )));
    }

    let row: Option<(String, serde_json::Value)> = sqlx::query_as(
        "SELECT release, payload FROM events WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(event_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let (release, payload) = row.ok_or(AppError::NotFound)?;

    let mut node = payload
        .get("error")
        .ok_or_else(|| AppError::Internal("event has no error".into()))?;
    for _ in 0..q.cause {
        node = match node.get("cause") {
            Some(c) if !c.is_null() => c,
            _ => return Err(AppError::NotFound),
        };
    }
    let stack = node
        .get("stack")
        .and_then(|s| s.as_array())
        .ok_or(AppError::NotFound)?;
    let frame = stack.get(q.frame).ok_or(AppError::NotFound)?;
    let pick = |sym: &str, raw: &str| {
        frame
            .get(raw)
            .and_then(|v| v.as_u64())
            .or_else(|| frame.get(sym).and_then(|v| v.as_u64()))
            .unwrap_or(0) as u32
    };
    let line = pick("line", "rawLine");
    let column = pick("column", "rawColumn");
    if line == 0 {
        return Err(AppError::NotFound);
    }
    let file = frame
        .get("file")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let context_lines = q
        .lines
        .unwrap_or(FRAME_SOURCE_CONTEXT_LINES_DEFAULT)
        .min(FRAME_SOURCE_CONTEXT_LINES_MAX);

    // First try the sourcemap path — JS frames resolve through here.
    let sourcemap_window =
        crate::symbolicate::source_for_frame(pool, &release, line, column, context_lines)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

    let window = if let Some(w) = sourcemap_window {
        Some(FrameSourceResponse {
            after: w.after,
            at: w.at,
            before: w.before,
            column: w.column,
            file: w.file,
            line: w.line,
        })
    } else if let Some(file) = file.as_deref() {
        // v1.2 W3.b: fall through to native source bundles when the
        // frame's file looks like Swift / Kotlin / Objective-C and a
        // source_bundle_<platform> artifact has been uploaded for this
        // release. Same FrameSourceResponse shape so the dashboard
        // renderer is unchanged.
        if let Some(platform) = crate::source_bundle::platform_for_file(file) {
            let release_id: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM releases WHERE project_id = $1 AND name = $2 LIMIT 1",
            )
            .bind(project_id)
            .bind(&release)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
            if let Some(release_id) = release_id {
                let bundle_window =
                    crate::source_bundle::lookup(pool, release_id, platform, file, line, context_lines)
                        .await
                        .map_err(|e| AppError::Internal(e.to_string()))?;
                bundle_window.map(|w| FrameSourceResponse {
                    after: w.after,
                    at: w.at,
                    before: w.before,
                    column,
                    file: w.file,
                    line: w.line,
                })
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let window = window.ok_or(AppError::NotFound)?;

    let body = Json(window);
    let mut response = body.into_response();
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, max-age=3600, immutable"),
    );
    Ok(response)
}
