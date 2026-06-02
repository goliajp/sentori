// User auth — register / verify / login / logout / me / password
// management / profile.
//
// v1.1 P2: split out of `api/user_auth.rs` (993 LOC) into logical
// sub-files. The public surface is preserved via re-exports so the
// router and other api modules continue to use
// `api::user_auth::login`, `api::user_auth::CurrentUser`, etc.

use axum::{
    extract::{Json, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::CookieJar;
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::recent::AppState;

// ── shared constants ───────────────────────────────────────────────────

pub const SESSION_COOKIE: &str = "sentori_session";
pub(super) const SESSION_TTL_DAYS: i64 = 30;
pub(super) const VERIFY_TTL_HOURS: i64 = 24;
pub(super) const PASSWORD_MIN_LEN: usize = 8;
pub(super) const EMAIL_MAX_LEN: usize = 254;
pub(super) const RESET_TOKEN_BYTES: usize = 32; // 256 bits
pub(super) const RESET_TTL_HOURS: i64 = 2;

// ── CurrentUser + middleware (used by other api modules) ──────────────

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

// ── shared response + validation helpers ──────────────────────────────

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

pub(super) fn ok_response() -> Response {
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

pub(super) fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

pub(super) fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized" })),
    )
        .into_response()
}

pub(super) fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}

// ── sub-modules + re-exports ───────────────────────────────────────────

mod dev;
mod password;
mod profile;
mod register;
mod session;

pub use dev::{dev_last_reset_token, dev_last_verify_token, DevTokenPeekQuery};
pub use password::{
    change_password, forgot_password, reset_password, ChangePasswordRequest,
    ForgotPasswordRequest, ResetPasswordRequest,
};
pub use profile::{oauth_providers, patch_me, PatchMeRequest};
pub use register::{register, verify, RegisterRequest, VerifyQuery};
pub use session::{login, logout, me, sign_out_everywhere, LoginRequest};
