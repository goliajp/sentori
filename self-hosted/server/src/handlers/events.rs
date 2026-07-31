//! GET /admin/api/events/{id} — one occurrence's full payload
//! (reached from an issue's occurrence list, never browsed).

use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::session_mw::SessionContext;
use crate::state::AppState;

pub async fn get(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path(event_id): Path<Uuid>,
) -> (StatusCode, Json<Value>) {
    let row = sqlx::query(
        "SELECT id, project_id, issue_id, kind, platform, occurred_at, received_at, \
                release, environment, user_key, payload \
         FROM events WHERE id = $1",
    )
    .bind(event_id)
    .fetch_optional(&state.pool)
    .await
    .unwrap_or(None);
    let Some(r) = row else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "event_not_found" })),
        );
    };
    let project_id: Uuid = r.get("project_id");
    if let Err(e) = super::admin::tokens::ensure_project_access(&state, &ctx, project_id).await {
        return e;
    }
    let attachments = sqlx::query(
        "SELECT ref, kind, media_type, size_bytes, captured_at FROM event_attachments \
         WHERE event_id = $1 ORDER BY captured_at",
    )
    .bind(event_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let atts: Vec<Value> = attachments
        .iter()
        .map(|a| {
            json!({
                "ref": a.get::<Uuid, _>("ref"),
                "kind": a.get::<String, _>("kind"),
                "mediaType": a.get::<String, _>("media_type"),
                "sizeBytes": a.get::<i32, _>("size_bytes"),
                "capturedAt": crate::wire_time::rfc3339(a.get("captured_at")),
            })
        })
        .collect();
    (
        StatusCode::OK,
        Json(json!({
            "id": r.get::<Uuid, _>("id"),
            "projectId": project_id,
            "issueId": r.get::<Uuid, _>("issue_id"),
            "kind": r.get::<String, _>("kind"),
            "platform": r.get::<String, _>("platform"),
            "occurredAt": crate::wire_time::rfc3339(r.get("occurred_at")),
            "receivedAt": crate::wire_time::rfc3339(r.get("received_at")),
            "release": r.get::<String, _>("release"),
            "environment": r.get::<String, _>("environment"),
            "userKey": r.get::<Option<String>, _>("user_key"),
            "payload": r.get::<Value, _>("payload"),
            "attachments": atts,
        })),
    )
}
