// Phase 13 sub-section B: user auth endpoints (register / verify / login /
// logout / me). DB-backed sessions live in the `sessions` table; the cookie
// only carries the random session id.

use axum::{
    extract::{Json, Query, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::passwd;
use crate::recent::AppState;

pub const SESSION_COOKIE: &str = "sentori_session";
const SESSION_TTL_DAYS: i64 = 30;
const VERIFY_TTL_HOURS: i64 = 24;
const PASSWORD_MIN_LEN: usize = 8;
const EMAIL_MAX_LEN: usize = 254;

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
    let insert = sqlx::query(
        "INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)",
    )
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
        let link = format!("{}/verify?token={}", state.base_url.trim_end_matches('/'), token);
        let _ = tx
            .try_send(crate::notifier::NotifyEvent::EmailVerification {
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

pub async fn verify(
    State(state): State<AppState>,
    Query(q): Query<VerifyQuery>,
) -> Response {
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

    ok_response()
}

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
        "INSERT INTO sessions (id, user_id, expires_at, ip, user_agent) \
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
        let _ = sqlx::query("DELETE FROM sessions WHERE id = $1")
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

    let row: Option<(Uuid, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT u.id, u.email, s.expires_at \
         FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.id = $1",
    )
    .bind(&session_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let (id, email, expires_at) = match row {
        Some(r) => r,
        None => return unauthorized(),
    };
    if expires_at < OffsetDateTime::now_utc() {
        return unauthorized();
    }

    (
        StatusCode::OK,
        Json(json!({ "user": { "id": id, "email": email } })),
    )
        .into_response()
}

/// Identifying information for the user behind the active session.
/// Inserted into request extensions by `require_user`; endpoints pull it
/// out via `Extension<CurrentUser>`.
#[derive(Clone, Debug)]
pub struct CurrentUser {
    pub id: Uuid,
    pub email: String,
}

/// Middleware guarding any endpoint that needs an authenticated user.
/// Reads the session cookie, resolves it through `current_user`, and
/// stores a `CurrentUser` extension so downstream handlers can extract it.
pub async fn require_user(
    State(state): State<AppState>,
    jar: CookieJar,
    mut req: Request,
    next: Next,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return unauthorized(),
    };
    let session_id = match jar.get(SESSION_COOKIE) {
        Some(c) => c.value().to_string(),
        None => return unauthorized(),
    };
    match current_user(&pool, &session_id).await {
        Some((id, email)) => {
            req.extensions_mut().insert(CurrentUser { id, email });
            next.run(req).await
        }
        None => unauthorized(),
    }
}

/// Resolve the user behind the session cookie. Returns Some((user_id, email))
/// on a valid, unexpired session; None otherwise. Used by sub-D's middleware
/// to scope admin requests to the calling user's orgs.
pub async fn current_user(pool: &PgPool, session_id: &str) -> Option<(Uuid, String)> {
    let row: Option<(Uuid, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT u.id, u.email, s.expires_at \
         FROM sessions s JOIN users u ON u.id = s.user_id \
         WHERE s.id = $1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let (id, email, expires_at) = row?;
    if expires_at < OffsetDateTime::now_utc() {
        return None;
    }
    Some((id, email))
}

/// Cheap structural validation — just enough to keep obvious garbage out of
/// the DB. Real verification happens via the email link.
pub fn is_plausible_email(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= EMAIL_MAX_LEN
        && s.contains('@')
        && !s.contains(char::is_whitespace)
}

pub fn random_token(byte_len: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

fn ok_response() -> Response {
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized" })),
    )
        .into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
