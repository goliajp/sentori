//! Sentori SaaS control-plane axum server.
//!
//! Post 2026-06-22 row-level pivot, this binary shares the same
//! Postgres database as `sentori-server` (no per-tenant DBs).
//! It exposes saasadmin-only endpoints for cross-workspace
//! management:
//!
//! - saasadmin login (session for the SaaS support staff)
//! - Workspace CRUD (create/list/suspend/resume/delete);
//!   "workspace" replaces the old "tenant" naming.
//! - Stripe webhook ingest — drives workspace_billing.plan +
//!   status flips per subscription lifecycle
//! - Cross-workspace health view for support
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
    // Note: schema migrations are owned by sentori-server. saas-
    // control reads/writes workspaces/workspace_billing etc.
    // directly — no separate control-plane migrations any more.

    let state = Arc::new(AppState::new(pool, stripe_secret));
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
