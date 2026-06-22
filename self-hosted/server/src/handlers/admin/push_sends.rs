//! GET /admin/api/projects/:project_id/push/sends
//!
//! Recent push attempts for ops triage — failed retries, slow
//! sends, vendor-error pattern hunting.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize, Default)]
pub struct ListQuery {
    pub status: Option<String>,
    pub limit: Option<u32>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> Json<Value> {
    let limit = q.limit.unwrap_or(100).clamp(1, 1000) as i64;
    let rows = if let Some(status) = q.status.as_deref() {
        sqlx::query(
            "SELECT id, token_id, provider, status, provider_outcome, error, retry_count, \
                    created_at, sent_at, next_attempt_at \
             FROM push_sends \
             WHERE project_id = $1 AND status = $2 \
             ORDER BY created_at DESC LIMIT $3",
        )
        .bind(project_id)
        .bind(status)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
    } else {
        sqlx::query(
            "SELECT id, token_id, provider, status, provider_outcome, error, retry_count, \
                    created_at, sent_at, next_attempt_at \
             FROM push_sends \
             WHERE project_id = $1 \
             ORDER BY created_at DESC LIMIT $2",
        )
        .bind(project_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await
    }
    .unwrap_or_default();
    let out: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id").to_string(),
                "token_id": r.get::<Uuid, _>("token_id").to_string(),
                "provider": r.get::<String, _>("provider"),
                "status": r.get::<String, _>("status"),
                "provider_outcome": r.try_get::<Option<String>, _>("provider_outcome").ok().flatten(),
                "error": r.try_get::<Option<String>, _>("error").ok().flatten(),
                "retry_count": r.try_get::<i32, _>("retry_count").unwrap_or(0),
                "created_at": r.get::<time::OffsetDateTime, _>("created_at"),
                "sent_at": r.try_get::<Option<time::OffsetDateTime>, _>("sent_at").ok().flatten(),
                "next_attempt_at": r.try_get::<Option<time::OffsetDateTime>, _>("next_attempt_at").ok().flatten(),
            })
        })
        .collect();
    Json(json!({ "sends": out }))
}
