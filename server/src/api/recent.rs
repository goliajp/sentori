use axum::{
    extract::{Json, State},
    http::StatusCode,
};

use crate::event::Event;
use crate::recent::RecentBuffer;

/// Dev-only endpoint: returns up to the last 100 events received in this
/// process's lifetime, newest last. Auth identical to the ingestion routes.
/// Phase 5 will replace this with a database-backed `/admin/api/.../events`.
pub async fn handle(
    State(recent): State<RecentBuffer>,
) -> (StatusCode, Json<Vec<Event>>) {
    (StatusCode::OK, Json(recent.snapshot()))
}
