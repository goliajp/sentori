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

    // Phase 13 sub-H: bootstrap a personal org if the user has none yet.
    // Best-effort — if it fails, the user lands on /onboarding in the
    // dashboard and can create one manually via the same orgs API.
    if let Err(e) = bootstrap_personal_org(&pool, user_id).await {
        tracing::warn!(error = %e, %user_id, "bootstrap personal org failed; user will hit /onboarding");
    }

    ok_response()
}

async fn bootstrap_personal_org(pool: &PgPool, user_id: Uuid) -> Result<(), sqlx::Error> {
    let already: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    if already {
        return Ok(());
    }

    let email: Option<String> =
        sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
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
    sqlx::query(
        "INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
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
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM orgs WHERE slug = $1)",
        )
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

    let (
        id,
        email,
        display_name,
        avatar_url,
        email_verified,
        is_superadmin,
        oauth_provider,
        expires_at,
    ) = match row {
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
         FROM auth_sessions s JOIN users u ON u.id = s.user_id \
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

// ─────────────────────────────────────────────────────────────────────
// v1.0 — profile + password management
// ─────────────────────────────────────────────────────────────────────

const RESET_TOKEN_BYTES: usize = 32; // 256 bits
const RESET_TTL_HOURS: i64 = 2;

#[derive(Deserialize)]
pub struct ForgotPasswordRequest {
    pub email: String,
}

/// POST /auth/forgot-password — issue a single-use reset token.
///
/// Always returns 200 OK regardless of whether the email matched a
/// real user. That's the standard "don't reveal which addresses are
/// registered" rule for password-reset endpoints.
///
/// When the email *does* match, we generate a 256-bit token, persist
/// it in `password_resets` with a 2 h expiry, and log the reset URL
/// at tracing INFO. Operators wire up their own SMTP / SES to ship
/// the link to the user (the notifier module handles outbound mail
/// for alerts; password-reset delivery is intentionally minimal here
/// to keep self-host options open).
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
        tracing::info!(
            email = %email,
            link = %link,
            expires_at = %expires_at,
            "password reset link issued (deliver via your operator-side SMTP)",
        );
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
///
/// Token is consumed atomically — second use returns
/// `tokenAlreadyUsed`. Expired tokens return `tokenExpired`.
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
    Json(body): Json<ChangePasswordRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    if body.new_password.len() < PASSWORD_MIN_LEN {
        return bad_request("passwordTooShort");
    }

    let existing: Option<(String,)> =
        sqlx::query_as("SELECT password_hash FROM users WHERE id = $1")
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

    ok_response()
}

#[derive(Deserialize)]
pub struct PatchMeRequest {
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

/// PATCH /auth/me — update display name and/or avatar URL.
///
/// Both fields are nullable so a client can clear them by sending
/// `null`. We use `Option<Option<String>>` semantics by treating
/// `None` (key absent) as "leave alone" and `Some(empty)` as "set
/// empty / clear".
pub async fn patch_me(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(body): Json<PatchMeRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    if let Some(ref name) = body.display_name {
        let trimmed = name.trim();
        if trimmed.chars().count() > 80 {
            return bad_request("displayNameTooLong");
        }
    }
    if let Some(ref url) = body.avatar_url {
        if url.len() > 512 {
            return bad_request("avatarUrlTooLong");
        }
        // Soft validation — must look like a URL when non-empty.
        if !url.is_empty() && !(url.starts_with("http://") || url.starts_with("https://")) {
            return bad_request("avatarUrlInvalid");
        }
    }

    // Build the SET clause dynamically — only touch what the caller asked us to.
    let mut set_parts: Vec<&'static str> = Vec::new();
    if body.display_name.is_some() {
        set_parts.push("display_name = $1");
    }
    if body.avatar_url.is_some() {
        if body.display_name.is_some() {
            set_parts.push("avatar_url = $2");
        } else {
            set_parts.push("avatar_url = $1");
        }
    }
    if set_parts.is_empty() {
        return ok_response();
    }
    let sql = format!(
        "UPDATE users SET {} WHERE id = ${}",
        set_parts.join(", "),
        set_parts.len() + 1,
    );

    let res = match (body.display_name, body.avatar_url) {
        (Some(name), Some(url)) => {
            sqlx::query(&sql)
                .bind(name)
                .bind(url)
                .bind(user.id)
                .execute(&pool)
                .await
        }
        (Some(name), None) => {
            sqlx::query(&sql)
                .bind(name)
                .bind(user.id)
                .execute(&pool)
                .await
        }
        (None, Some(url)) => sqlx::query(&sql).bind(url).bind(user.id).execute(&pool).await,
        (None, None) => unreachable!("set_parts emptiness already returned"),
    };
    if res.is_err() {
        return server_error("dbError");
    }
    ok_response()
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

// ─────────────────────────────────────────────────────────────────────
// v1.0 — OAuth provider configuration discovery
// ─────────────────────────────────────────────────────────────────────

/// GET /auth/oauth/providers — tells the dashboard which OAuth
/// buttons to render. Endpoint always responds; the response shape
/// is `{ google: bool, github: bool }`. The buttons are hidden when
/// the corresponding env var pair is unset.
///
/// Full OAuth code-exchange flow (start / callback) lands in a
/// follow-up — this endpoint is the contract surface so the dashboard
/// can render correctly *now* without conditioning on whether the
/// flow is wired yet.
pub async fn oauth_providers(State(_state): State<AppState>) -> Response {
    let github = std::env::var("SENTORI_GITHUB_CLIENT_ID").is_ok()
        && std::env::var("SENTORI_GITHUB_CLIENT_SECRET").is_ok();
    let google = std::env::var("SENTORI_GOOGLE_CLIENT_ID").is_ok()
        && std::env::var("SENTORI_GOOGLE_CLIENT_SECRET").is_ok();
    (
        StatusCode::OK,
        Json(json!({ "github": github, "google": google })),
    )
        .into_response()
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
