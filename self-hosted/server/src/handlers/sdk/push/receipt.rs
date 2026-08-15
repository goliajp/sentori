//! GET `/v1/push/receipts/{send_id}` — poll delivery receipt status.

use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use sentori_ingest_token::IngestContext;
use serde_json::{Value, json};
use sqlx::Row;
use tracing::warn;
use uuid::Uuid;

use crate::state::AppState;

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Path(send_id): Path<Uuid>,
) -> (StatusCode, Json<Value>) {
    let row = sqlx::query(
        "SELECT id, status, provider, provider_outcome, error, sent_at, acked_at, retry_count \
         FROM push_sends WHERE id = $1 AND project_id = $2",
    )
    .bind(send_id)
    .bind(ctx.project_id)
    .fetch_optional(&state.pool)
    .await;

    match row {
        Ok(Some(r)) => (
            StatusCode::OK,
            Json(json!({
                "send_id": send_id.to_string(),
                "status": r.get::<String, _>("status"),
                "provider": r.get::<String, _>("provider"),
                "provider_outcome": r.get::<Option<String>, _>("provider_outcome"),
                "error": r.get::<Option<String>, _>("error"),
                "sent_at": crate::wire_time::rfc3339_opt(r.get::<Option<time::OffsetDateTime>, _>("sent_at")),
                "acked_at": crate::wire_time::rfc3339_opt(r.get::<Option<time::OffsetDateTime>, _>("acked_at")),
                "retry_count": r.get::<i32, _>("retry_count"),
            })),
        ),
        // A 404 and a 500, not two more values in `status`. An id that
        // does not exist and a database that is down both used to come
        // back 200 carrying a word, so a typo and an outage read the
        // same to anything checking the field.
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "delivery_not_found" })),
        ),
        Err(e) => {
            warn!(error = %e, "push.receipt db_error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}
