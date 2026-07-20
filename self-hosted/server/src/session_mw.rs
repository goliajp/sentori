//! Cookie / Bearer session middleware for dashboard + admin
//! routes.
//!
//! Resolves the session token from either:
//! 1. `Authorization: Bearer <session_token_wire>` header
//! 2. `Cookie: sentori_session=<session_token_wire>`
//!
//! On success injects `Extension<SessionContext { user_id }>`
//! into the request. On failure returns 401 with `WWW-Authenticate`.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use sentori_auth_session::{AuthOptions, AuthService};
use sentori_cookie_session::SecretKey;
use sentori_workspace_identity::UserId;
use serde_json::json;
use tracing::warn;

use crate::state::AppState;

#[derive(Clone, Copy, Debug)]
pub struct SessionContext {
    pub user_id: UserId,
}

pub async fn session_middleware(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let token = match extract_token(&headers) {
        Some(t) => t,
        None => return reject("session token missing"),
    };

    let auth = build_auth(&state);
    match auth.lookup_session(&token).await {
        Ok(Some((user, _session))) => {
            req.extensions_mut()
                .insert(SessionContext { user_id: user.id });
            next.run(req).await
        }
        Ok(None) => reject("session expired or invalid"),
        Err(e) => {
            warn!(error = %e, "session lookup failed");
            reject("internal")
        }
    }
}

fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers.get(header::AUTHORIZATION) {
        if let Ok(s) = auth.to_str() {
            if let Some(rest) = s.strip_prefix("Bearer ") {
                return Some(rest.trim().to_string());
            }
        }
    }
    if let Some(cookie_hdr) = headers.get(header::COOKIE) {
        if let Ok(s) = cookie_hdr.to_str() {
            for part in s.split(';') {
                let p = part.trim();
                if let Some(rest) = p.strip_prefix("sentori_session=") {
                    return Some(rest.trim().to_string());
                }
            }
        }
    }
    None
}

fn build_auth(state: &Arc<AppState>) -> AuthService {
    let raw = std::env::var("SENTORI_SESSION_SECRET").ok();
    let key = match raw {
        Some(s) if s.len() >= 32 => {
            let mut a = [0u8; 32];
            a.copy_from_slice(&s.as_bytes()[..32]);
            SecretKey::from_bytes(a)
        }
        _ => SecretKey::generate().expect("ephemeral session key"),
    };
    AuthService::new(state.identity.clone(), key, AuthOptions::default())
}

fn reject(reason: &str) -> Response {
    let body = json!({ "error": "unauthorized", "reason": reason });
    let mut resp = (StatusCode::UNAUTHORIZED, axum::Json(body)).into_response();
    resp.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        header::HeaderValue::from_static("Bearer realm=\"sentori\""),
    );
    resp
}
