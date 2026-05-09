use axum::{
    extract::{Json, Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;
use serde_json::json;

use crate::recent::AppState;
use crate::session;

pub const SESSION_COOKIE: &str = "sentori_session";

#[derive(Deserialize)]
pub struct LoginRequest {
    pub password: String,
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<LoginRequest>,
) -> Response {
    if !constant_time_eq(body.password.as_bytes(), state.admin_password.as_bytes()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "unauthorized" })),
        )
            .into_response();
    }

    let token = session::sign(&state.session_secret);
    let cookie = Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .build();

    (StatusCode::OK, jar.add(cookie), Json(json!({ "ok": true }))).into_response()
}

pub async fn logout(jar: CookieJar) -> Response {
    let removed = jar.remove(Cookie::from(SESSION_COOKIE));
    (StatusCode::OK, removed, Json(json!({ "ok": true }))).into_response()
}

pub async fn me(jar: CookieJar, State(state): State<AppState>) -> Response {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        if session::verify(&state.session_secret, c.value()) {
            return (StatusCode::OK, Json(json!({ "ok": true }))).into_response();
        }
    }
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized" })),
    )
        .into_response()
}

/// Allows access if either:
/// 1. The `sentori_session` cookie has a valid HMAC, or
/// 2. A Bearer token in `Authorization` is accepted by `AuthState::validate`
///    (dev token or `tokens` row).
/// The Bearer fallback exists for tests, CLI tools, and future scripted clients.
pub async fn require_admin(
    State(state): State<AppState>,
    jar: CookieJar,
    req: Request,
    next: Next,
) -> Response {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        if session::verify(&state.session_secret, c.value()) {
            return next.run(req).await;
        }
    }
    let bearer = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    if let Some(token) = bearer {
        if state.auth.validate(token).await {
            return next.run(req).await;
        }
    }
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized" })),
    )
        .into_response()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
