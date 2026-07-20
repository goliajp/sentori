//! Control-plane HTTP handlers.
//!
//! Only the Stripe webhook receiver lives here. Workspace
//! management moved to `sentori-server`'s `/admin/api/saas/*`,
//! which reuses the dashboard session plus the `saasadmin_only`
//! role gate — one management surface, one auth model.

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};

use crate::state::AppState;

mod health;
mod stripe_webhook;

pub fn router(state: Arc<AppState>) -> Router {
    // The Stripe webhook authenticates by HMAC over the raw body
    // against the endpoint secret, not by bearer token, so it
    // needs no session middleware.
    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/v1/saas/stripe/webhook", post(stripe_webhook::ingest))
        .with_state(state)
}
