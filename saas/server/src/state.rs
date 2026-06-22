//! Shared app state for the control plane.

use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    /// Control-plane postgres pool (sentori_saas DB).
    pub pool: PgPool,
    /// Admin postgres URL for `CREATE DATABASE` on tenant
    /// provision. Typically points at the `postgres` super
    /// database with create-DB privileges.
    pub tenant_db_admin_url: String,
    /// Stripe webhook secret (`whsec_xxx`). None disables
    /// the webhook endpoint (self-hosted dev mode).
    pub stripe_secret: Option<String>,
}

impl AppState {
    #[must_use]
    pub const fn new(
        pool: PgPool,
        tenant_db_admin_url: String,
        stripe_secret: Option<String>,
    ) -> Self {
        Self {
            pool,
            tenant_db_admin_url,
            stripe_secret,
        }
    }
}
