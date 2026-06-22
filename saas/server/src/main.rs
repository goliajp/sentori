//! Sentori SaaS control-plane axum server.
//!
//! NOT the tenant workload — that's `self-hosted/server/`
//! pointed at each tenant's database. This binary handles:
//!
//! - Signup landing page + saasadmin login
//! - Tenant CRUD + provisioning (creates a fresh
//!   `sentori_t_<slug>` postgres DB + runs core migrations
//!   + seeds the owner user)
//! - Stripe webhook ingest (S5 stone) + subscription state
//!   sync into the `subscriptions` table
//! - Cross-tenant health dashboard for support staff
//!
//! Per CSaas1+5 autonomous design 2026-06-21.

#![forbid(unsafe_code)]
#![allow(
    clippy::doc_markdown,
    clippy::missing_panics_doc,
    clippy::missing_errors_doc,
    clippy::missing_const_for_fn,
    clippy::module_name_repetitions
)]

use std::sync::Arc;

use anyhow::Context;
use axum::Router;
use sqlx::PgPool;
use tokio::net::TcpListener;
use tracing::info;

mod handlers;
mod state;
mod stripe;
mod tenant_provision;

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    let bind = std::env::var("SENTORI_SAAS_BIND").unwrap_or_else(|_| "0.0.0.0:9090".to_string());
    let cp_db_url = std::env::var("SENTORI_SAAS_CONTROL_PLANE_DB_URL")
        .context("SENTORI_SAAS_CONTROL_PLANE_DB_URL env var required")?;
    let tenant_db_admin_url = std::env::var("SENTORI_SAAS_TENANT_DB_ADMIN_URL")
        .context("SENTORI_SAAS_TENANT_DB_ADMIN_URL env var required (used to CREATE DATABASE for new tenants)")?;
    let stripe_secret = std::env::var("SENTORI_STRIPE_WEBHOOK_SECRET").ok();

    info!(%bind, "sentori SaaS control-plane boot");
    let pool = PgPool::connect(&cp_db_url).await.context("control-plane db connect")?;
    sqlx::migrate!("../migrations").run(&pool).await.context("control-plane migrate")?;

    let state = Arc::new(AppState::new(pool, tenant_db_admin_url, stripe_secret));
    let app = handlers::router(state);

    let listener = TcpListener::bind(&bind).await.context("bind")?;
    info!(%bind, "ready");
    axum::serve(listener, app).await.context("serve")?;
    Ok(())
}

fn init_tracing() {
    let _ = std::env::var("RUST_LOG");
}

fn _ensure_axum_used() {
    let _ = Router::<()>::new();
}
