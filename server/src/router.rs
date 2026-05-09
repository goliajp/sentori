use axum::{Router, middleware, routing::post};
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

use crate::api;
use crate::auth::{AuthState, require_token};

const MAX_BODY_BYTES: usize = 1024 * 1024; // 1 MB per protocol.md size limits

pub fn build(dev_token: String) -> Router {
    let auth_state = AuthState::new(dev_token);

    Router::new()
        .route("/v1/events", post(api::events::handle))
        .route("/v1/events:batch", post(api::events_batch::handle))
        .route_layer(middleware::from_fn_with_state(auth_state, require_token))
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
