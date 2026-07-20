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

mod auth_mw;
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
    wait_for_saasadmin_schema(&pool).await?;
    bootstrap_saasadmin(&pool).await?;

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

/// Block until `sentori-server` has applied migration 0031.
///
/// Returns an error rather than looping forever so a genuinely
/// broken deployment fails loudly instead of hanging silently.
async fn wait_for_saasadmin_schema(pool: &PgPool) -> anyhow::Result<()> {
    for attempt in 1..=30u32 {
        let exists: Option<(String,)> =
            sqlx::query_as("SELECT to_regclass('saasadmin_users')::text")
                .fetch_optional(pool)
                .await?;
        if matches!(exists, Some((ref t,)) if !t.is_empty()) {
            return Ok(());
        }
        if attempt == 1 {
            info!("waiting for core migration 0031 (saasadmin tables)");
        }
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    }
    anyhow::bail!(
        "saasadmin_users still absent after 60s — is sentori-server running \
         migrations against the same database?"
    )
}

/// Create the first `super` operator from env, once.
///
/// Without this there is no way to obtain a session at all: login
/// reads `saasadmin_users`, and nothing else writes it. Idempotent
/// — an existing row for the address is left untouched, so the
/// password can't be reset by restarting the process.
async fn bootstrap_saasadmin(pool: &PgPool) -> anyhow::Result<()> {
    let (Ok(email), Ok(password)) = (
        std::env::var("SENTORI_SAASADMIN_BOOTSTRAP_EMAIL"),
        std::env::var("SENTORI_SAASADMIN_BOOTSTRAP_PASSWORD"),
    ) else {
        info!("no SENTORI_SAASADMIN_BOOTSTRAP_EMAIL/_PASSWORD — skipping operator bootstrap");
        return Ok(());
    };
    let email = email.trim().to_ascii_lowercase();
    if email.is_empty() || password.len() < 12 {
        anyhow::bail!("saasadmin bootstrap needs a non-empty email and a password of 12+ chars");
    }

    let existing: Option<(uuid::Uuid,)> =
        sqlx::query_as("SELECT id FROM saasadmin_users WHERE lower(email) = $1")
            .bind(&email)
            .fetch_optional(pool)
            .await?;
    if existing.is_some() {
        info!(%email, "saasadmin already present; bootstrap is a no-op");
        return Ok(());
    }

    let hash = sentori_argon2_password::PasswordHash::hash(&password)
        .map_err(|e| anyhow::anyhow!("hash saasadmin password: {e}"))?;
    sqlx::query(
        "INSERT INTO saasadmin_users (id, email, password_hash, display_name, role) \
         VALUES ($1, $2, $3, $4, 'super')",
    )
    .bind(uuid::Uuid::now_v7())
    .bind(&email)
    .bind(&hash)
    .bind(
        std::env::var("SENTORI_SAASADMIN_BOOTSTRAP_NAME")
            .unwrap_or_else(|_| "Operator".to_string()),
    )
    .execute(pool)
    .await?;
    info!(%email, "first saasadmin created (role=super)");
    Ok(())
}
