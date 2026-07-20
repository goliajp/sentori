//! Shared app state for the SaaS control plane.
//!
//! Post 2026-06-22 row-level pivot, this binary shares the same
//! Postgres database as `sentori-server` (all workspaces in one
//! DB, row-level isolation by workspace_id). The `tenant_db_admin_url`
//! field is retired — `CREATE DATABASE` is no longer part of
//! tenant provisioning.

use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    /// Shared postgres pool — same DB as sentori-server.
    pub pool: PgPool,
    /// Stripe webhook secret (`whsec_xxx`). None disables the
    /// webhook endpoint (dev mode).
    pub stripe_secret: Option<String>,
}

impl AppState {
    #[must_use]
    pub const fn new(pool: PgPool, stripe_secret: Option<String>) -> Self {
        Self {
            pool,
            stripe_secret,
        }
    }
}
