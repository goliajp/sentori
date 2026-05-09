use sqlx::PgPool;
use uuid::{Uuid, uuid};

/// Stable, hand-picked dev IDs (uuid v7 layout). The org/user are created
/// by migration 0007's seed inserts; this module only ensures the project
/// row exists. Real projects (Phase 5 sub-section C+) get fresh uuid v7s.
pub const DEV_PROJECT_ID: Uuid = uuid!("019508a0-0000-7000-8000-000000000000");
pub const DEV_ORG_ID: Uuid = uuid!("019508a0-0001-7000-8000-000000000000");

pub async fn ensure_dev_project(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO projects (id, name, org_id) VALUES ($1, 'dev', $2) \
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(DEV_PROJECT_ID)
    .bind(DEV_ORG_ID)
    .execute(pool)
    .await?;
    Ok(())
}
