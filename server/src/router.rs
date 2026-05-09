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

pub struct ServerConfig {
    pub dev_token: String,
    pub db: Option<sqlx::PgPool>,
    pub valkey: Option<redis::aio::ConnectionManager>,
    pub project_id: uuid::Uuid,
    pub rate_limit_per_min: u32,
    pub admin_password: String,
    pub session_secret: String,
}

pub fn build(cfg: ServerConfig) -> Router {
    let auth_state = AuthState::new(cfg.dev_token, cfg.db.clone());
    let recent = RecentBuffer::new();
    let state = AppState {
        auth: auth_state.clone(),
        recent,
        db: cfg.db,
        valkey: cfg.valkey,
        project_id: cfg.project_id,
        rate_limit_per_min: cfg.rate_limit_per_min,
        admin_password: cfg.admin_password,
        session_secret: cfg.session_secret,
    };

    let ingestion = Router::new()
        .route("/v1/events", post(api::events::handle))
        .route("/v1/events:batch", post(api::events_batch::handle))
        .route("/v1/events/_recent", get(api::recent::handle))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            crate::rate_limit::rate_limit_middleware,
        ))
        .route_layer(middleware::from_fn_with_state(auth_state, require_token));

    let admin_protected = Router::new()
        .route(
            "/projects/{project_id}/issues",
            get(api::admin::list_issues),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}",
            get(api::admin::issue_detail).patch(api::admin::patch_issue),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/events",
            get(api::admin::list_events_for_issue),
        )
        .route(
            "/releases/{release_name}/sourcemaps",
            post(api::releases::upload_sourcemaps),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            api::admin_auth::require_admin,
        ));

    let admin_public = Router::new()
        .route("/login", post(api::admin_auth::login))
        .route("/logout", post(api::admin_auth::logout))
        .route("/me", get(api::admin_auth::me));

    let admin = Router::new().merge(admin_protected).merge(admin_public);

    Router::new()
        .merge(ingestion)
        .nest("/admin/api", admin)
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
