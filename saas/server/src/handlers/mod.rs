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
    // ── destructive: `super` role only ──────────────────────
    // Deleting or suspending a workspace takes a customer's data
    // offline; staff accounts can look but not touch.
    let destructive = Router::new()
        .route("/v1/saas/workspaces/{id}", delete(tenants::delete))
        .route(
            "/v1/saas/workspaces/{id}/suspend",
            post(saasadmin::suspend_tenant),
        )
        .route(
            "/v1/saas/workspaces/{id}/resume",
            post(saasadmin::resume_tenant),
        )
        // Legacy /tenants aliases preserved so existing saasadmin
        // scripts / bookmarks keep working.
        .route("/v1/saas/tenants/{id}", delete(tenants::delete))
        .route(
            "/v1/saas/tenants/{id}/suspend",
            post(saasadmin::suspend_tenant),
        )
        .route(
            "/v1/saas/tenants/{id}/resume",
            post(saasadmin::resume_tenant),
        )
        .layer(axum::middleware::from_fn(crate::auth_mw::require_super))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth_mw::require_saasadmin,
        ))
        .with_state(state.clone());

    // ── cross-workspace reads + create: any live session ────
    let gated = Router::new()
        .route(
            "/v1/saas/workspaces",
            get(tenants::list).post(tenants::create),
        )
        .route(
            "/v1/saas/tenants",
            get(tenants::list).post(tenants::create),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::auth_mw::require_saasadmin,
        ))
        .with_state(state.clone());

    // ── public ──────────────────────────────────────────────
    // `login` is how a session is obtained in the first place;
    // the Stripe webhook authenticates by HMAC over the raw body
    // against the endpoint secret, not by bearer token.
    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/v1/saas/saasadmin/login", post(saasadmin::login))
        .route("/v1/saas/stripe/webhook", post(stripe_webhook::ingest))
        .with_state(state)
        .merge(gated)
        .merge(destructive)
}
