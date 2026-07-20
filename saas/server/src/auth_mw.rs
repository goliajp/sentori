//! saasadmin session gate.
//!
//! Every control-plane route except `/healthz`, the login endpoint
//! and the Stripe webhook is cross-workspace and destructive —
//! `DELETE /v1/saas/workspaces/{id}` removes a customer's
//! workspace. Until 2026-07-20 none of them checked anything: the
//! binary shipped `login` (which mints a row in
//! `saasadmin_sessions`) but no middleware that ever read that
//! table back, so the only thing keeping them safe was that the
//! service had no public route.
//!
//! Auth is `Authorization: Bearer <token>` where `<token>` is the
//! hex string login returned. We look up `sha256(token)` in
//! `saasadmin_sessions`, reject expired rows, and attach the
//! resolved [`SaasAdmin`] as a request extension.
//!
//! The Stripe webhook is exempt because it authenticates
//! differently — HMAC over the raw body against the endpoint
//! secret (see `handlers/stripe_webhook.rs`); a bearer token would
//! be meaningless to Stripe.

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::state::AppState;

/// The operator behind the current request.
#[derive(Clone, Debug)]
pub struct SaasAdmin {
    pub user_id: Uuid,
    pub email: String,
    /// `staff` (read-only intent) or `super`.
    pub role: String,
}

impl SaasAdmin {
    /// True for the role allowed to run destructive operations.
    #[must_use]
    pub fn is_super(&self) -> bool {
        self.role == "super"
    }
}

fn unauthorized(detail: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(serde_json::json!({
            "error": "unauthorized",
            "detail": detail,
        })),
    )
        .into_response()
}

/// Reject any request without a live saasadmin session.
pub async fn require_saasadmin(
    State(state): State<Arc<AppState>>,
    mut req: Request,
    next: Next,
) -> Response {
    let Some(token) = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
    else {
        return unauthorized("send `Authorization: Bearer <saasadmin session token>`");
    };

    let token_hash = hex::encode(Sha256::digest(
        // The token is hex on the wire; hash the decoded bytes so
        // this matches exactly what `login` stored.
        match hex::decode(token) {
            Ok(raw) => raw,
            Err(_) => return unauthorized("malformed session token"),
        },
    ));

    let row: Result<Option<(Uuid, String, String)>, _> = sqlx::query_as(
        "SELECT u.id, u.email, u.role \
         FROM saasadmin_sessions s \
         JOIN saasadmin_users u ON u.id = s.user_id \
         WHERE s.token_hash = $1 AND s.expires_at > now()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await;

    match row {
        Ok(Some((user_id, email, role))) => {
            req.extensions_mut().insert(SaasAdmin {
                user_id,
                email,
                role,
            });
            next.run(req).await
        }
        // Expired and unknown collapse to the same answer so a
        // caller can't probe which tokens once existed.
        Ok(None) => unauthorized("session unknown or expired"),
        Err(e) => {
            tracing::error!(%e, "saasadmin session lookup failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "session_lookup_failed" })),
            )
                .into_response()
        }
    }
}

/// Gate destructive routes behind the `super` role.
pub async fn require_super(req: Request, next: Next) -> Response {
    let ok = req
        .extensions()
        .get::<SaasAdmin>()
        .is_some_and(SaasAdmin::is_super);
    if !ok {
        return (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({
                "error": "forbidden",
                "detail": "this operation requires the `super` saasadmin role",
            })),
        )
            .into_response();
    }
    next.run(req).await
}
