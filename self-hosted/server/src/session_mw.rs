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

/// Who the caller is, and which workspace their reads are confined
/// to.
///
/// `workspace_id` is resolved here rather than left to each handler:
/// dashboard queries used to select across the whole table, so any
/// authenticated user saw every tenant's projects, events, spans,
/// metrics and replays. Carrying the scope on the request makes the
/// filter something a handler has to actively drop rather than
/// something it has to remember to add.
#[derive(Clone, Copy, Debug)]
pub struct SessionContext {
    pub user_id: UserId,
    pub workspace_id: sentori_workspace_identity::WorkspaceId,
}

pub async fn session_middleware(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let Some(token) = extract_token(&headers) else {
        return reject("session token missing");
    };

    let auth = build_auth(&state);
    match auth.lookup_session(&token).await {
        Ok(Some((user, _session))) => {
            // users.workspace_id is NOT NULL, so a live session always
            // resolves to exactly one workspace.
            let ws: Result<Option<(uuid::Uuid,)>, _> =
                sqlx::query_as("SELECT workspace_id FROM users WHERE id = $1")
                    .bind(user.id.into_uuid())
                    .fetch_optional(&state.pool)
                    .await;
            let workspace_id = match ws {
                Ok(Some((id,))) => sentori_workspace_identity::WorkspaceId::from_uuid(id),
                Ok(None) => return reject("session user no longer exists"),
                Err(e) => {
                    warn!(error = %e, "workspace lookup failed");
                    return reject("internal");
                }
            };
            req.extensions_mut().insert(SessionContext {
                user_id: user.id,
                workspace_id,
            });
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
    if let Some(auth) = headers.get(header::AUTHORIZATION)
        && let Ok(s) = auth.to_str()
        && let Some(rest) = s.strip_prefix("Bearer ")
    {
        return Some(rest.trim().to_string());
    }
    if let Some(cookie_hdr) = headers.get(header::COOKIE)
        && let Ok(s) = cookie_hdr.to_str()
    {
        for part in s.split(';') {
            let p = part.trim();
            if let Some(rest) = p.strip_prefix("sentori_session=") {
                return Some(rest.trim().to_string());
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
        // Only fails if the OS CSPRNG is unavailable, which no request
        // could be served through anyway.
        #[allow(clippy::expect_used)]
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
