use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
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

/// v1.0 — operator superadmin bootstrap.
///
/// Looks up `SENTORI_SUPERADMIN_EMAIL` from the environment. When set,
/// makes sure there's a user row with that email and `is_superadmin =
/// TRUE`. Idempotent — running the server twice doesn't duplicate
/// anything.
///
/// The seeded user can't password-login (their `password_hash` is the
/// sentinel string `oauth:seeded:no-password`); they sign in via:
///   1. The forgot-password flow — we log a fresh reset link at INFO
///      every boot when the user has no usable password hash yet, OR
///   2. GitHub / Google OAuth, once the operator wires the env vars.
///
/// `SENTORI_SUPERADMIN_DISPLAY_NAME` is optional and only used on the
/// first insert.
pub async fn ensure_superadmin(pool: &PgPool) -> anyhow::Result<()> {
    let Ok(email_raw) = std::env::var("SENTORI_SUPERADMIN_EMAIL") else {
        return Ok(());
    };
    let email = email_raw.trim().to_ascii_lowercase();
    if email.is_empty() {
        return Ok(());
    }
    let display_name = std::env::var("SENTORI_SUPERADMIN_DISPLAY_NAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let existing: Option<(Uuid, String, bool)> =
        sqlx::query_as("SELECT id, password_hash, is_superadmin FROM users WHERE email = $1")
            .bind(&email)
            .fetch_optional(pool)
            .await?;

    let (user_id, password_hash) = match existing {
        Some((id, hash, is_super)) => {
            if !is_super {
                sqlx::query("UPDATE users SET is_superadmin = TRUE WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                tracing::info!(email = %email, user_id = %id, "superadmin upgraded existing user");
            }
            (id, hash)
        }
        None => {
            let id = Uuid::now_v7();
            let placeholder = "oauth:seeded:no-password".to_string();
            sqlx::query(
                "INSERT INTO users (id, email, password_hash, email_verified, \
                                    is_superadmin, display_name) \
                 VALUES ($1, $2, $3, TRUE, TRUE, $4)",
            )
            .bind(id)
            .bind(&email)
            .bind(&placeholder)
            .bind(display_name.as_deref())
            .execute(pool)
            .await?;
            tracing::info!(email = %email, user_id = %id, "superadmin seeded");
            (id, placeholder)
        }
    };

    // If the seeded user has the sentinel password hash, issue a
    // fresh reset token. Try to deliver via SMTP; always log too so
    // the operator can still grab the link from `docker compose logs`
    // even when SMTP is mid-flap.
    if password_hash == "oauth:seeded:no-password" {
        let token = random_token(32);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(48);
        sqlx::query(
            "INSERT INTO password_resets (token, user_id, expires_at) \
             VALUES ($1, $2, $3)",
        )
        .bind(&token)
        .bind(user_id)
        .bind(expires_at)
        .execute(pool)
        .await?;
        let base = std::env::var("SENTORI_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8000".to_string());
        let link = format!("{base}/reset-password/{token}");
        tracing::info!(
            email = %email,
            link = %link,
            "superadmin reset-password link (valid 48 h)",
        );
        match crate::mailer::send_password_reset(&email, &link).await {
            Ok(true) => tracing::info!(email = %email, "superadmin reset email delivered"),
            Ok(false) => tracing::info!(email = %email, "SMTP not configured; link is logged above"),
            Err(e) => tracing::warn!(error = ?e, email = %email, "superadmin reset email send failed; link is logged above"),
        }
    }

    Ok(())
}

/// v1.0 — operator-side project bootstrap.
///
/// Optional: when `SENTORI_SEED_PROJECT_NAME` is set, idempotently
/// creates a project with that name inside the org owned by the
/// superadmin (or the dev org as a fallback). Useful for spinning up
/// "first real project to point your SDK at" without hand-running SQL.
///
/// Env shape:
///   SENTORI_SEED_PROJECT_NAME      — required to enable seeding
///   SENTORI_SEED_PROJECT_ORG_SLUG  — optional, defaults to "dev"
///   SENTORI_SEED_PROJECT_ORG_NAME  — only used on first org insert
pub async fn ensure_seed_project(pool: &PgPool) -> anyhow::Result<()> {
    let Ok(project_name) = std::env::var("SENTORI_SEED_PROJECT_NAME") else {
        return Ok(());
    };
    let project_name = project_name.trim().to_string();
    if project_name.is_empty() {
        return Ok(());
    }

    let org_slug = std::env::var("SENTORI_SEED_PROJECT_ORG_SLUG")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "dev".to_string());
    let org_display = std::env::var("SENTORI_SEED_PROJECT_ORG_NAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| org_slug.clone());

    // Resolve the org. Reuse the dev org if slug == "dev", else
    // upsert a new one owned by the (first) superadmin if one exists.
    let org_id: Uuid = if org_slug == "dev" {
        DEV_ORG_ID
    } else {
        let existing: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM orgs WHERE slug = $1")
            .bind(&org_slug)
            .fetch_optional(pool)
            .await?;
        if let Some((id,)) = existing {
            id
        } else {
            // Owner: prefer the first superadmin; fall back to the
            // dev user seeded in migration 0007 so the new org row
            // satisfies the owner_id FK either way.
            let owner_id: Uuid = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM users WHERE is_superadmin = TRUE ORDER BY created_at LIMIT 1",
            )
            .fetch_optional(pool)
            .await?
            .unwrap_or(uuid!("019508a0-0002-7000-8000-000000000000"));
            let new_org_id = Uuid::now_v7();
            sqlx::query(
                "INSERT INTO orgs (id, slug, name, owner_id) VALUES ($1, $2, $3, $4) \
                 ON CONFLICT (slug) DO NOTHING",
            )
            .bind(new_org_id)
            .bind(&org_slug)
            .bind(&org_display)
            .bind(owner_id)
            .execute(pool)
            .await?;
            sqlx::query(
                "INSERT INTO memberships (org_id, user_id, role) \
                 VALUES ($1, $2, 'owner') \
                 ON CONFLICT (org_id, user_id) DO NOTHING",
            )
            .bind(new_org_id)
            .bind(owner_id)
            .execute(pool)
            .await?;
            new_org_id
        }
    };

    // Insert the project if it doesn't already exist (by name within org).
    let already: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM projects WHERE org_id = $1 AND name = $2")
            .bind(org_id)
            .bind(&project_name)
            .fetch_optional(pool)
            .await?;
    if already.is_some() {
        return Ok(());
    }
    let project_id = Uuid::now_v7();
    sqlx::query("INSERT INTO projects (id, name, org_id) VALUES ($1, $2, $3)")
        .bind(project_id)
        .bind(&project_name)
        .bind(org_id)
        .execute(pool)
        .await?;
    tracing::info!(
        org_slug = %org_slug,
        project_name = %project_name,
        project_id = %project_id,
        "seed project ensured",
    );
    Ok(())
}

fn random_token(byte_len: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}
