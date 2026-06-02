// login / logout / me / sign_out_everywhere — session lifecycle.
//
// v1.1 P2 split-out of `api/user_auth.rs`.

use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;
use serde_json::json;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{
    ok_response, random_token, server_error, unauthorized, CurrentUser, SESSION_COOKIE,
    SESSION_TTL_DAYS,
};
use crate::passwd;
use crate::recent::AppState;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(sqlx::FromRow)]
struct UserRow {
    id: Uuid,
    email: String,
    password_hash: String,
    email_verified: bool,
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    let email = body.email.trim().to_ascii_lowercase();
    let user: Option<UserRow> = sqlx::query_as(
        "SELECT id, email, password_hash, email_verified FROM users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let user = match user {
        Some(u) => u,
        None => return unauthorized(),
    };

    if !passwd::verify(&body.password, &user.password_hash) {
        return unauthorized();
    }
    if !user.email_verified {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "emailNotVerified" })),
        )
            .into_response();
    }

    let session_id = random_token(32);
    let expires_at = OffsetDateTime::now_utc() + Duration::days(SESSION_TTL_DAYS);
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string());
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Err(e) = sqlx::query(
        "INSERT INTO auth_sessions (id, user_id, expires_at, ip, user_agent) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&session_id)
    .bind(user.id)
    .bind(expires_at)
    .bind(ip.as_deref())
    .bind(user_agent.as_deref())
    .execute(&pool)
    .await
    {
        tracing::error!(error = %e, "insert session failed");
        return server_error("sessionFailed");
    }

    let secure = state.base_url.starts_with("https://");
    let cookie = Cookie::build((SESSION_COOKIE, session_id))
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .max_age(Duration::days(SESSION_TTL_DAYS))
        .build();

    (
        StatusCode::OK,
        jar.add(cookie),
        Json(json!({
            "ok": true,
            "user": { "id": user.id, "email": user.email },
        })),
    )
        .into_response()
}

pub async fn logout(State(state): State<AppState>, jar: CookieJar) -> Response {
    if let (Some(pool), Some(c)) = (&state.db, jar.get(SESSION_COOKIE)) {
        let _ = sqlx::query("DELETE FROM auth_sessions WHERE id = $1")
            .bind(c.value())
            .execute(pool)
            .await;
    }
    let removed = jar.remove(Cookie::from(SESSION_COOKIE));
    (StatusCode::OK, removed, Json(json!({ "ok": true }))).into_response()
}

pub async fn me(State(state): State<AppState>, jar: CookieJar) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return unauthorized(),
    };

    let session_id = match jar.get(SESSION_COOKIE) {
        Some(c) => c.value().to_string(),
        None => return unauthorized(),
    };

    let row: Option<(
        Uuid,
        String,
        Option<String>,
        Option<String>,
        bool,
        bool,
        Option<String>,
        OffsetDateTime,
    )> = sqlx::query_as(
        "SELECT u.id, u.email, u.display_name, u.avatar_url, \
                u.email_verified, u.is_superadmin, u.oauth_provider, s.expires_at \
         FROM auth_sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.id = $1",
    )
    .bind(&session_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let (id, email, display_name, avatar_url, email_verified, is_superadmin, oauth_provider, expires_at) =
        match row {
            Some(r) => r,
            None => return unauthorized(),
        };
    if expires_at < OffsetDateTime::now_utc() {
        return unauthorized();
    }

    (
        StatusCode::OK,
        Json(json!({
            "user": {
                "id": id,
                "email": email,
                "displayName": display_name,
                "avatarUrl": avatar_url,
                "emailVerified": email_verified,
                "isSuperadmin": is_superadmin,
                "oauthProvider": oauth_provider,
            },
        })),
    )
        .into_response()
}

/// POST /auth/sign-out-everywhere — invalidates every session for
/// the current user EXCEPT the one making the call. The caller keeps
/// their cookie; all other devices are signed out.
pub async fn sign_out_everywhere(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    jar: CookieJar,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };
    let keep = jar
        .get(SESSION_COOKIE)
        .map(|c| c.value().to_string())
        .unwrap_or_default();
    if keep.is_empty() {
        return unauthorized();
    }
    if sqlx::query("DELETE FROM auth_sessions WHERE user_id = $1 AND id <> $2")
        .bind(user.id)
        .bind(&keep)
        .execute(&pool)
        .await
        .is_err()
    {
        return server_error("dbError");
    }
    ok_response()
}

