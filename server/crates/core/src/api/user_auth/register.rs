// register / verify — first-time user signup + email verification.
//
// v1.1 P2 split-out of `api/user_auth.rs`.

use axum::{
    extract::{Json, Query, State},
    response::Response,
};
use serde::Deserialize;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{
    bad_request, is_plausible_email, ok_response, random_token, server_error,
    PASSWORD_MIN_LEN, VERIFY_TTL_HOURS,
};
use crate::passwd;
use crate::recent::AppState;

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    let email = body.email.trim().to_ascii_lowercase();
    if !is_plausible_email(&email) {
        return bad_request("invalidEmail");
    }
    if body.password.len() < PASSWORD_MIN_LEN {
        return bad_request("passwordTooShort");
    }

    let password_hash = match passwd::hash(&body.password) {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(error = %e, "argon2 hash failed");
            return server_error("hashFailed");
        }
    };

    let user_id = Uuid::now_v7();
    let insert = sqlx::query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)")
        .bind(user_id)
        .bind(&email)
        .bind(&password_hash)
        .execute(&pool)
        .await;

    match insert {
        Ok(_) => {}
        Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
            // Don't reveal whether the email exists; pretend success so an
            // attacker can't enumerate users via the register endpoint.
            return ok_response();
        }
        Err(e) => {
            tracing::error!(error = %e, "insert user failed");
            return server_error("insertFailed");
        }
    }

    let token = random_token(32);
    let expires_at = OffsetDateTime::now_utc() + Duration::hours(VERIFY_TTL_HOURS);
    if let Err(e) = sqlx::query(
        "INSERT INTO email_verifications (token, user_id, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(&token)
    .bind(user_id)
    .bind(expires_at)
    .execute(&pool)
    .await
    {
        tracing::error!(error = %e, "insert email_verification failed");
        // Continue — user can ask for a resend later. Don't surface to client.
    }

    if let Some(tx) = &state.notifier_tx {
        let link = format!(
            "{}/verify?token={}",
            state.base_url.trim_end_matches('/'),
            token
        );
        let _ = tx.try_send(crate::notifier::NotifyEvent::EmailVerification {
            email: email.clone(),
            link,
        });
    }

    ok_response()
}

#[derive(Deserialize)]
pub struct VerifyQuery {
    pub token: String,
}

pub async fn verify(State(state): State<AppState>, Query(q): Query<VerifyQuery>) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    let row: Option<(Uuid, OffsetDateTime)> = sqlx::query_as(
        "SELECT user_id, expires_at FROM email_verifications WHERE token = $1",
    )
    .bind(&q.token)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let (user_id, expires_at) = match row {
        Some(r) => r,
        None => return bad_request("invalidToken"),
    };
    if expires_at < OffsetDateTime::now_utc() {
        return bad_request("tokenExpired");
    }

    let _ = sqlx::query("UPDATE users SET email_verified = TRUE WHERE id = $1")
        .bind(user_id)
        .execute(&pool)
        .await;
    let _ = sqlx::query("DELETE FROM email_verifications WHERE token = $1")
        .bind(&q.token)
        .execute(&pool)
        .await;

    // Phase 13 sub-H: bootstrap a personal org if the user has none yet.
    // Best-effort — if it fails, the user lands on /onboarding in the
    // dashboard and can create one manually via the same orgs API.
    if let Err(e) = bootstrap_personal_org(&pool, user_id).await {
        tracing::warn!(error = %e, %user_id, "bootstrap personal org failed; user will hit /onboarding");
    }

    ok_response()
}

async fn bootstrap_personal_org(pool: &PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
    let already: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM memberships WHERE user_id = $1)")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    if already {
        return Ok(());
    }

    let email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    let email = match email {
        Some(e) => e,
        None => return Ok(()),
    };

    let candidate = email_to_slug_candidate(&email);
    let slug = unique_slug(pool, &candidate).await?;
    let name = email.split('@').next().unwrap_or(&slug).to_string();
    let org_id = Uuid::now_v7();

    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO orgs (id, slug, name, owner_id) VALUES ($1, $2, $3, $4)")
        .bind(org_id)
        .bind(&slug)
        .bind(&name)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')")
        .bind(org_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    crate::quotas::ensure_default_quota(&mut *tx, org_id).await?;
    tx.commit().await?;
    tracing::info!(%user_id, %slug, "personal org bootstrapped");
    Ok(())
}

/// Derive a slug candidate from the email's local part. Replaces non
/// alphanumeric chars with '-', trims, lowercases, caps at 28 chars.
/// Falls back to a uuid-derived stub if the result is empty, too short,
/// or all digits.
fn email_to_slug_candidate(email: &str) -> String {
    let local = email.split('@').next().unwrap_or("user");
    let cleaned: String = local
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed: String = cleaned
        .trim_matches('-')
        .chars()
        .take(28)
        .collect::<String>()
        .replace("--", "-");
    if trimmed.len() < 3 || trimmed.chars().all(|c| c.is_ascii_digit()) {
        format!("user-{}", &Uuid::now_v7().to_string()[..6])
    } else {
        trimmed
    }
}

async fn unique_slug(pool: &PgPool, candidate: &str) -> Result<String, sqlx::Error> {
    let mut slug = candidate.to_string();
    for n in 2..=100 {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM orgs WHERE slug = $1)")
            .bind(&slug)
            .fetch_one(pool)
            .await?;
        if !exists {
            return Ok(slug);
        }
        slug = format!("{candidate}-{n}");
    }
    Ok(format!("user-{}", &Uuid::now_v7().to_string()[..8]))
}
