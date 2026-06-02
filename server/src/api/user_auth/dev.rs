// Dev-only token peek endpoints.
//
// e2e tests (playwright) need to clip a token out of the database to
// drive the second step of a multi-step flow. In CI we can't shell
// into a postgres container, and we don't want to add a `pg` runtime
// dep to the dashboard just for tests. These endpoints close that
// gap.
//
// Gated by SENTORI_EXPOSE_DEV_TOKENS=1 at the router; in prod the env
// is never set so the routes don't mount.

use axum::{
    extract::{Json, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;

use super::server_error;
use crate::recent::AppState;

#[derive(Deserialize)]
pub struct DevTokenPeekQuery {
    pub email: String,
}

pub async fn dev_last_verify_token(
    State(state): State<AppState>,
    Query(q): Query<DevTokenPeekQuery>,
) -> Response {
    let Some(pool) = state.db.clone() else {
        return server_error("db not configured");
    };
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT ev.token FROM email_verifications ev \
         JOIN users u ON u.id = ev.user_id \
         WHERE u.email = $1 \
         ORDER BY ev.created_at DESC LIMIT 1",
    )
    .bind(&q.email)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    match row {
        Some((token,)) => (StatusCode::OK, Json(json!({ "token": token }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": "notFound" }))).into_response(),
    }
}

pub async fn dev_last_reset_token(
    State(state): State<AppState>,
    Query(q): Query<DevTokenPeekQuery>,
) -> Response {
    let Some(pool) = state.db.clone() else {
        return server_error("db not configured");
    };
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT pr.token FROM password_resets pr \
         JOIN users u ON u.id = pr.user_id \
         WHERE u.email = $1 \
         ORDER BY pr.created_at DESC LIMIT 1",
    )
    .bind(&q.email)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    match row {
        Some((token,)) => (StatusCode::OK, Json(json!({ "token": token }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": "notFound" }))).into_response(),
    }
}
