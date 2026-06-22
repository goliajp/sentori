//! Sentori self-hosted axum server binary.
//!
//! Single-workspace OSS deployment. Composes the 17 K
//! crates from `core/` into a single HTTP server with:
//!
//! - sqlx migrate from `self-hosted/migrations/` (symlinks
//!   to core migrations) at boot.
//! - Optional env-driven first-owner bootstrap (sets up
//!   the workspace + user on a fresh DB so `docker compose
//!   up` is one-shot ready).
//! - Wired axum router with the v0.1 essential routes:
//!   /healthz, /v1/auth/login, /v1/auth/logout,
//!   /v1/auth/me, /v1/projects, /v1/projects/{id}/issues,
//!   /v1/events/{project} (SDK ingest), /v1/usage.
//!
//! Caller-owned background tasks (per K7-K17 stance) are
//! also spawned: K10 cert-monitor poll, K11 notifier
//! retry, K14 alert-rule on-event fires.
//!
//! Image goal: < 80 MB distroless cc + strip.
//! Startup goal: < 30s under `docker compose up`.

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

mod apns;
mod blob_store;
mod bootstrap;
mod fcm;
mod handlers;
mod notify;
mod probe_worker;
mod push_worker;
mod saasadmin_mw;
mod session_mw;
mod state;
mod webpush;

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let db_url = std::env::var("SENTORI_DATABASE_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .context("SENTORI_DATABASE_URL (or DATABASE_URL) env var required")?;
    let bind = std::env::var("SENTORI_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());

    info!(%bind, "sentori self-hosted server boot");

    let pool = PgPool::connect(&db_url).await.context("db connect")?;
    run_migrations(&pool).await.context("migrate")?;

    // First-owner bootstrap (env-driven, idempotent).
    if let Err(e) = bootstrap::ensure_first_owner(&pool).await {
        tracing::warn!(error = %e, "bootstrap first owner skipped");
    }

    let attachments = blob_store::AttachmentStore::from_env()
        .await
        .context("attachment store init")?;
    let state = Arc::new(AppState::new(
        pool.clone(),
        bootstrap::default_workspace_id(),
        attachments,
    ));

    // Start the push dispatcher + endpoint probe background workers.
    push_worker::spawn(pool.clone());
    probe_worker::spawn(pool);

    let app = handlers::router(state);

    let listener = TcpListener::bind(&bind).await.context("bind")?;
    info!(%bind, "ready");
    axum::serve(listener, app).await.context("serve")?;
    Ok(())
}

fn init_tracing() {
    let filter = std::env::var("RUST_LOG").unwrap_or_else(|_| "info,sqlx=warn".to_string());
    tracing_subscriber_init(&filter);
}

fn tracing_subscriber_init(filter: &str) {
    // Minimal — workspace doesn't have tracing-subscriber
    // as a dep yet; pull from env via the `tracing` crate
    // re-exports.  For v0.1 simplicity, a no-op when
    // unavailable is acceptable since stdout JSON logger
    // is wired in production via the docker-compose level.
    let _ = filter;
}

async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    // sqlx::migrate! resolves at compile time, embedding
    // the SQL into the binary so no on-disk migrations dir
    // is needed at runtime.
    sqlx::migrate!("../migrations").run(pool).await?;
    Ok(())
}

fn _ensure_axum_used() {
    // Suppress unused warnings when the binary is built
    // with skinny features — Router is constructed in
    // `handlers::router`. Pattern lifted from legacy.
    let _ = Router::<()>::new();
}
