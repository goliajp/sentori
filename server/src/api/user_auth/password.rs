// Password lifecycle — forgot / reset / change.
//
// v1.1 P2 split-out of `api/user_auth.rs`.

use axum::{
    extract::{Json, State},
    response::Response,
};
use axum_extra::extract::cookie::CookieJar;
use serde::Deserialize;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{
    bad_request, is_plausible_email, ok_response, random_token, server_error, unauthorized,
    CurrentUser, PASSWORD_MIN_LEN, RESET_TOKEN_BYTES, RESET_TTL_HOURS, SESSION_COOKIE,
};
use crate::passwd;
use crate::recent::AppState;

#[derive(Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

/// POST /auth/forgot-password — issue a single-use reset token.
///
/// Always returns 200 OK regardless of whether the email matched a
/// real user. That's the standard "don't reveal which addresses are
/// registered" rule for password-reset endpoints.
pub async fn forgot_password(
    State(state): State<AppState>,
    Json(body): Json<ForgotPasswordRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    let email = body.email.trim().to_ascii_lowercase();
    if !is_plausible_email(&email) {
        // Still return 200 — silent on validation.
        return ok_response();
    }

    let user_row: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();

    if let Some((user_id,)) = user_row {
        let token = random_token(RESET_TOKEN_BYTES);
        let expires_at = OffsetDateTime::now_utc() + Duration::hours(RESET_TTL_HOURS);
        if let Err(e) = sqlx::query(
            "INSERT INTO password_resets (token, user_id, expires_at) \
             VALUES ($1, $2, $3)",
        )
        .bind(&token)
        .bind(user_id)
        .bind(expires_at)
        .execute(&pool)
        .await
        {
            tracing::error!(error = %e, "forgot_password: insert reset token failed");
            return server_error("dbError");
        }
        let base = std::env::var("SENTORI_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8000".to_string());
        let link = format!("{base}/reset-password/{token}");

        match crate::mailer::send_password_reset(&email, &link).await {
            Ok(true) => {
                tracing::info!(email = %email, "password reset email delivered");
            }
            Ok(false) => {
                tracing::info!(
                    email = %email,
                    link = %link,
                    expires_at = %expires_at,
                    "password reset link issued (SMTP not configured, deliver out of band)",
                );
            }
            Err(e) => {
                tracing::warn!(
                    error = ?e,
                    email = %email,
                    link = %link,
                    "password reset email send failed; link is logged here as fallback",
                );
            }
        }
    } else {
        tracing::info!(email = %email, "password reset requested for unknown email (200 silently)");
    }

    ok_response()
}

#[derive(Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub password: String,
}

/// POST /auth/reset-password — exchange a reset token for a new pwd.
pub async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    if body.password.len() < PASSWORD_MIN_LEN {
        return bad_request("passwordTooShort");
    }

    let row: Option<(Uuid, OffsetDateTime, Option<OffsetDateTime>)> = sqlx::query_as(
        "SELECT user_id, expires_at, used_at FROM password_resets WHERE token = $1",
    )
    .bind(&body.token)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let (user_id, expires_at, used_at) = match row {
        Some(r) => r,
        None => return bad_request("tokenInvalid"),
    };
    if used_at.is_some() {
        return bad_request("tokenAlreadyUsed");
    }
    if expires_at < OffsetDateTime::now_utc() {
        return bad_request("tokenExpired");
    }

    let password_hash = match passwd::hash(&body.password) {
        Ok(h) => h,
        Err(_) => return server_error("hashFailed"),
    };

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(_) => return server_error("txBegin"),
    };
    if sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(&password_hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .is_err()
    {
        let _ = tx.rollback().await;
        return server_error("dbError");
    }
    if sqlx::query("UPDATE password_resets SET used_at = now() WHERE token = $1")
        .bind(&body.token)
        .execute(&mut *tx)
        .await
        .is_err()
    {
        let _ = tx.rollback().await;
        return server_error("dbError");
    }
    if tx.commit().await.is_err() {
        return server_error("txCommit");
    }

    // Invalidate any active sessions so the freshly-rotated password
    // takes effect immediately on every device.
    let _ = sqlx::query("DELETE FROM auth_sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(&pool)
        .await;

    ok_response()
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    #[serde(rename = "currentPassword")]
    pub current_password: String,
    #[serde(rename = "newPassword")]
    pub new_password: String,
}

/// POST /auth/change-password — for a user already logged in. Requires
/// the current password to defend against session-hijack-then-rotate
/// attacks (industry standard).
pub async fn change_password(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    jar: CookieJar,
    Json(body): Json<ChangePasswordRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    if body.new_password.len() < PASSWORD_MIN_LEN {
        return bad_request("passwordTooShort");
    }

    let existing: Option<(String,)> = sqlx::query_as("SELECT password_hash FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
    let (current_hash,) = match existing {
        Some(r) => r,
        None => return unauthorized(),
    };

    if !passwd::verify(&body.current_password, &current_hash) {
        return bad_request("invalidCurrentPassword");
    }

    let new_hash = match passwd::hash(&body.new_password) {
        Ok(h) => h,
        Err(_) => return server_error("hashFailed"),
    };

    if sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(&new_hash)
        .bind(user.id)
        .execute(&pool)
        .await
        .is_err()
    {
        return server_error("dbError");
    }

    // Account page promises "Changing your password signs you out of
    // all other devices." Honor that by deleting every session for
    // this user except the calling one.
    let keep = jar
        .get(SESSION_COOKIE)
        .map(|c| c.value().to_string())
        .unwrap_or_default();
    if !keep.is_empty() {
        let _ = sqlx::query("DELETE FROM auth_sessions WHERE user_id = $1 AND id <> $2")
            .bind(user.id)
            .bind(&keep)
            .execute(&pool)
            .await;
    }

    ok_response()
}
