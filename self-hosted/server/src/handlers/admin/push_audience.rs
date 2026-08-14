//! POST /admin/api/projects/:project_id/push/audience/preview
//!
//! How many devices an audience selects, and a few of them.
//!
//! Without this the only way to find out what an expression matches is
//! to send to it, which is not a thing anyone can undo. A condition
//! editor that cannot answer "how many?" is a text box that fires
//! notifications at strangers.
//!
//! The count comes from the same compiler the send uses, so a preview
//! that says 412 is not an estimate of what a send would do — it is
//! the same query with `count(*)` in front of it.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tracing::warn;
use uuid::Uuid;

use crate::session_mw::SessionContext;
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewBody {
    #[serde(default)]
    pub app_user_id: Option<String>,
    #[serde(default)]
    pub traits: Option<Value>,
    #[serde(default)]
    pub audience: Option<Value>,
}

/// How many of the matched devices to show.
///
/// Enough to tell "this is the group I meant" from "this is every
/// device I have", which is the question a sample answers. More than
/// that is a device list, and there is already one of those.
const SAMPLE: i64 = 8;

pub async fn preview(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<PreviewBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    super::tokens::ensure_project_access(&state, &ctx, project_id).await?;

    let audience = crate::audience::from_request(
        body.app_user_id.as_deref(),
        body.traits.as_ref(),
        body.audience.as_ref(),
    )
    .map_err(|detail| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "bad_audience", "detail": detail })),
        )
    })?;

    let Some(audience) = audience else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "bad_audience",
                "detail": "give appUserId, traits or audience",
            })),
        ));
    };

    // `$1` is the project; the audience numbers from `$2`.
    let (frag, binds) = audience.to_sql(2);
    let where_clause = format!("dt.project_id = $1 AND dt.revoked_at IS NULL AND ({frag})");

    let count_sql = format!("SELECT count(*) AS n FROM device_tokens dt WHERE {where_clause}");
    let mut q = sqlx::query(&count_sql).bind(project_id);
    for b in &binds {
        q = b.attach(q);
    }
    let matched = q
        .fetch_one(&state.pool)
        .await
        .map(|r| r.get::<i64, _>("n"))
        .map_err(|e| {
            // The compiler produces valid SQL for anything it accepted, so
            // a failure here is ours rather than the caller's — and saying
            // "no devices" would read as an answer.
            warn!(error = %e, "push.audience preview_failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        })?;

    // The token itself never comes back — the device list is careful
    // about that and a preview must not be the way around it.
    let sample_sql = format!(
        "SELECT dt.id, dt.provider, dt.traits, dt.metadata, \
                dt.user_key IS NOT NULL AS addressable, \
                right(dt.user_key, 6) AS user_key_tail \
         FROM device_tokens dt WHERE {where_clause} \
         ORDER BY dt.last_seen_at DESC LIMIT {SAMPLE}"
    );
    let mut q = sqlx::query(&sample_sql).bind(project_id);
    for b in &binds {
        q = b.attach(q);
    }
    let rows = q.fetch_all(&state.pool).await.unwrap_or_default();

    let sample: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id").to_string(),
                "provider": r.get::<String, _>("provider"),
                "traits": r.get::<Value, _>("traits"),
                "metadata": r.get::<Value, _>("metadata"),
                "addressable": r.get::<bool, _>("addressable"),
                "userKeyTail": r.get::<Option<String>, _>("user_key_tail"),
            })
        })
        .collect();

    Ok(Json(json!({ "matched": matched, "sample": sample })))
}
