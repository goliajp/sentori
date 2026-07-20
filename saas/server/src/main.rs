//! Sentori SaaS control-plane axum server.
//!
//! Post 2026-06-22 row-level pivot, this binary shares the same
//! Postgres database as `sentori-server` (no per-tenant DBs).
//!
//! It is now **only the Stripe webhook receiver** — the webhook
//! drives `workspace_billing.plan` + `status` flips across the
//! subscription lifecycle, authenticating by HMAC over the raw
//! body against the endpoint secret.
//!
//! Workspace management (create / list / suspend / resume /
//! delete) moved to `sentori-server`'s `/admin/api/saas/*`, gated
//! by the dashboard session plus the `saasadmin_only` role
//! middleware. That is the surface the webapp already
//! authenticates against, so folding the operations in leaves one
//! management surface and one auth model instead of two.
//!
//! Consequently this binary no longer uses the
//! `saasadmin_users` / `saasadmin_sessions` tables from core
//! migration 0031. The tables and the migration are intentionally
//! left in place; only the control plane's dependency on them is
//! gone.
//!
//! The `tenant_db_admin_url` config + `CREATE DATABASE` logic
//! from the original v0.1 saas/server is retired.

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

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    let bind = std::env::var("SENTORI_SAAS_BIND").unwrap_or_else(|_| "0.0.0.0:9090".to_string());
    let db_url = std::env::var("SENTORI_SAAS_DATABASE_URL")
        .or_else(|_| std::env::var("SENTORI_SAAS_CONTROL_PLANE_DB_URL"))
        .or_else(|_| std::env::var("DATABASE_URL"))
        .context("SENTORI_SAAS_DATABASE_URL (or DATABASE_URL) env var required")?;
    let stripe_secret = std::env::var("SENTORI_STRIPE_WEBHOOK_SECRET").ok();

    info!(%bind, "sentori SaaS control-plane boot");
    let pool = PgPool::connect(&db_url).await.context("db connect")?;
    // Schema is owned by sentori-server's core/migrations (both
    // binaries share one database), including the saasadmin tables
    // added in 0031. Wait for them rather than assume: saas-control
    // may boot first on a cold cluster, and every route below needs
    // them.
    // No schema wait and no operator seeding any more: workspace
    // management moved to sentori-server's /admin/api/saas/*, so this
    // binary needs neither migration 0031 nor an account of its own.
    // The Stripe webhook authenticates by HMAC over the raw body.

    let state = Arc::new(AppState::new(pool, stripe_secret));
    let app = handlers::router(state);

    let listener = TcpListener::bind(&bind).await.context("bind")?;
    info!(%bind, "ready");
    axum::serve(listener, app).await.context("serve")?;
    Ok(())
}

fn init_tracing() {
    // Was a no-op stub, so this binary produced zero logs in
    // production — the same gap sentori-server had until v1.4.1.
    let filter = std::env::var("RUST_LOG").unwrap_or_else(|_| "info,sqlx=warn".to_string());
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(filter))
        .init();
}

fn _ensure_axum_used() {
    let _ = Router::<()>::new();
}
