//! Tenant provisioning logic.
//!
//! 4-step state machine recorded in `tenant_provisions`:
//!   1. create_db   — CREATE DATABASE sentori_t_<slug>
//!   2. migrate     — run core/migrations against the new DB
//!   3. seed_owner  — create the initial Owner user
//!   4. activate    — flip tenant status to 'active'
//!
//! Each step writes a row so a crashed mid-provision can
//! resume by replaying any non-`done` step.

use sqlx::PgPool;
use uuid::Uuid;

/// Create a fresh tenant database. The `admin_url` must
/// point at a PG account with CREATEDB privilege.
///
/// `db_name` MUST be a valid postgres identifier — callers
/// constrain it to `sentori_t_<slug>` where slug matches
/// `^[a-z][a-z0-9_]+$` (CHECK constraint at the
/// `tenants.slug` column level enforces this end-to-end).
///
/// # Errors
///
/// [`sqlx::Error`] on backend failure.
pub async fn create_tenant_db(admin_url: &str, db_name: &str) -> anyhow::Result<()> {
    if !is_safe_db_name(db_name) {
        return Err(anyhow::anyhow!(
            "unsafe db_name {db_name:?}; expected [a-z0-9_]+"
        ));
    }
    let admin = PgPool::connect(admin_url).await?;
    let sql = format!("CREATE DATABASE \"{db_name}\"");
    sqlx::query(&sql).execute(&admin).await?;
    Ok(())
}

/// True when `name` is safe to interpolate into a CREATE
/// DATABASE statement. Conservative — lowercase ASCII +
/// digits + underscore + leading alpha only.
#[must_use]
pub fn is_safe_db_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 63 {
        return false;
    }
    let bytes = name.as_bytes();
    if !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    bytes.iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_')
}

/// Record one provision step.
///
/// # Errors
///
/// [`sqlx::Error`] on backend failure.
pub async fn record_step(
    pool: &PgPool,
    tenant_id: Uuid,
    step: &str,
    state: &str,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r"
        INSERT INTO tenant_provisions (id, tenant_id, step, state, started_at, completed_at, error)
        VALUES ($1, $2, $3, $4, now(), CASE WHEN $4 IN ('done', 'failed') THEN now() END, $5)
        ",
    )
    .bind(Uuid::now_v7())
    .bind(tenant_id)
    .bind(step)
    .bind(state)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_db_name_accepts_typical_tenant() {
        assert!(is_safe_db_name("sentori_t_acme"));
        assert!(is_safe_db_name("sentori_t_abc123"));
    }

    #[test]
    fn is_safe_db_name_rejects_injection_attempts() {
        assert!(!is_safe_db_name(""));
        assert!(!is_safe_db_name("DROP TABLE"));
        assert!(!is_safe_db_name("sentori-t-acme")); // hyphen
        assert!(!is_safe_db_name("123_leading_digit"));
        assert!(!is_safe_db_name("sentori\"; DROP--"));
        assert!(!is_safe_db_name(&"x".repeat(64))); // too long
    }
}
