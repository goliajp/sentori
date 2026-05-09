use axum::{
    Router, middleware,
    routing::{get, post},
};
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

use crate::api;
use crate::auth::{AuthState, require_token};
use crate::recent::{AppState, RecentBuffer};

const MAX_BODY_BYTES: usize = 1024 * 1024; // 1 MB per protocol.md size limits

pub fn build(
    dev_token: String,
    db: Option<sqlx::PgPool>,
    project_id: uuid::Uuid,
) -> Router {
    let auth_state = AuthState::new(dev_token);
    let recent = RecentBuffer::new();
    let state = AppState {
        auth: auth_state.clone(),
        recent,
        db,
        project_id,
    };

    Router::new()
        .route("/v1/events", post(api::events::handle))
        .route("/v1/events:batch", post(api::events_batch::handle))
        .route("/v1/events/_recent", get(api::recent::handle))
        .route(
            "/v1/projects/{project_id}/issues",
            get(api::admin::list_issues),
        )
        .route(
            "/v1/projects/{project_id}/issues/{issue_id}",
            get(api::admin::issue_detail),
        )
        .route(
            "/v1/projects/{project_id}/issues/{issue_id}/events",
            get(api::admin::list_events_for_issue),
        )
        .route_layer(middleware::from_fn_with_state(auth_state, require_token))
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
