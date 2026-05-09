use sqlx::PgPool;
use uuid::{Uuid, uuid};

/// Stable, hand-picked dev project id (uuid v7 layout).
/// Real projects (Phase 5 sub-section C+) get fresh uuid v7s.
pub const DEV_PROJECT_ID: Uuid = uuid!("019508a0-0000-7000-8000-000000000000");

pub async fn ensure_dev_project(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO projects (id, name) VALUES ($1, 'dev') ON CONFLICT (id) DO NOTHING")
        .bind(DEV_PROJECT_ID)
        .execute(pool)
        .await?;
    Ok(())
}
