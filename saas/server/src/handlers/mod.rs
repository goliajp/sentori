//! Control-plane HTTP handlers.

use std::sync::Arc;

use axum::Router;
use axum::routing::{delete, get, post};

use crate::state::AppState;

mod health;
mod saasadmin;
mod stripe_webhook;
mod tenants;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(health::healthz))
        // New row-level / workspace-named routes
        .route(
            "/v1/saas/workspaces",
            get(tenants::list).post(tenants::create),
        )
        .route("/v1/saas/workspaces/{id}", delete(tenants::delete))
        .route(
            "/v1/saas/workspaces/{id}/suspend",
            post(saasadmin::suspend_tenant),
        )
        .route(
            "/v1/saas/workspaces/{id}/resume",
            post(saasadmin::resume_tenant),
        )
        // Legacy /tenants aliases preserved so existing
        // saasadmin scripts / bookmarks keep working.
        .route(
            "/v1/saas/tenants",
            get(tenants::list).post(tenants::create),
        )
        .route("/v1/saas/tenants/{id}", delete(tenants::delete))
        .route(
            "/v1/saas/tenants/{id}/suspend",
            post(saasadmin::suspend_tenant),
        )
        .route(
            "/v1/saas/tenants/{id}/resume",
            post(saasadmin::resume_tenant),
        )
        .route("/v1/saas/saasadmin/login", post(saasadmin::login))
        .route("/v1/saas/stripe/webhook", post(stripe_webhook::ingest))
        .with_state(state)
}
