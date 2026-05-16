use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct AuthState {
    inner: Arc<AuthStateInner>,
}

struct AuthStateInner {
    dev_token: String,
    db: Option<PgPool>,
}

/// Phase 14 sub-A/E: identifies who's posting events. `require_token`
/// puts this in the request extensions so handlers know which project
/// to attribute the event to (DevToken falls back to AppState.project_id
/// for back-compat with single-tenant dev flows).
///
/// Phase 15 sub-B adds `org_id` to the Token variant so the quota check
/// can run without an extra projects-join per event.
#[derive(Clone, Debug)]
pub enum IngestCaller {
    DevToken,
    Token { org_id: Uuid, project_id: Uuid },
}

impl AuthState {
    pub fn new(dev_token: String, db: Option<PgPool>) -> Self {
        Self {
            inner: Arc::new(AuthStateInner { dev_token, db }),
        }
    }

    /// Resolve a Bearer token to the calling identity. Returns None if
    /// the token doesn't match the dev secret and isn't an unrevoked
    /// row in `tokens`.
    pub async fn resolve(&self, token: &str) -> Option<IngestCaller> {
        if self.matches_dev(token) {
            return Some(IngestCaller::DevToken);
        }
        if let Some(pool) = &self.inner.db {
            match self.lookup_token_row(pool, token).await {
                Ok(Some((project_id, org_id))) => {
                    return Some(IngestCaller::Token { org_id, project_id });
                }
                Ok(None) => {}
                Err(e) => {
                    tracing::error!(error = %e, "token DB lookup failed");
                }
            }
        }
        None
    }

    /// Boolean form retained for `admin_auth::require_admin`'s
    /// dev-token / DB-token fallback path.
    pub async fn validate(&self, token: &str) -> bool {
        self.resolve(token).await.is_some()
    }

    fn matches_dev(&self, token: &str) -> bool {
        let a = self.inner.dev_token.as_bytes();
        let b = token.as_bytes();
        if a.len() != b.len() {
            return false;
        }
        let mut diff: u8 = 0;
        for (x, y) in a.iter().zip(b.iter()) {
            diff |= x ^ y;
        }
        diff == 0
    }

    async fn lookup_token_row(
        &self,
        pool: &PgPool,
        token: &str,
    ) -> Result<Option<(Uuid, Uuid)>, sqlx::Error> {
        let token_hash = hash_token(token);
        let row: Option<(Uuid, Uuid)> = sqlx::query_as(
            "SELECT project_id, org_id FROM tokens \
             WHERE token_hash = $1 AND revoked_at IS NULL",
        )
        .bind(&token_hash)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }
}

/// sha256(token) hex — used to look up `tokens.token_hash` and to key
/// the rate-limit counters in Valkey.
pub fn hash_token(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex::encode(h.finalize())
}

#[derive(Serialize)]
struct ErrorBody {
    error: &'static str,
    hint: &'static str,
}

pub async fn require_token(
    State(state): State<AuthState>,
    mut req: Request,
    next: Next,
) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));

    let Some(token) = token else {
        return unauthorized("send `Authorization: Bearer <st_pk_… token>` — find it in the dashboard under project settings → tokens");
    };

    let Some(caller) = state.resolve(token).await else {
        return unauthorized(token_hint(token));
    };

    req.extensions_mut().insert(caller);
    next.run(req).await
}

/// Pick a 401 hint by inspecting the rejected token's shape.
pub(crate) fn token_hint(token: &str) -> &'static str {
    if token.starts_with("st_pk_") {
        "token has the right prefix but wasn't recognized — it may have been revoked, or it belongs to a different project"
    } else {
        "token must start with `st_pk_` — you may have pasted the wrong value (e.g. an org slug or project id). Both ingest tokens (kind=public) and admin tokens (kind=admin) share the `st_pk_` prefix in v0.x; kind is enforced on the server, not by prefix."
    }
}

fn unauthorized(hint: &'static str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorBody { error: "unauthorized", hint }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::token_hint;

    #[test]
    fn token_hint_distinguishes_shape_from_value() {
        // Right prefix, wrong value → "revoked / wrong project".
        assert!(token_hint("st_pk_deadbeef").contains("revoked"));
        // `sk_…` is no longer a recognised prefix — v0.x ships
        // everything as `st_pk_…` with kind enforced server-side.
        assert!(token_hint("sk_abc123").contains("must start with"));
        // Not a token at all → "must start with st_pk_".
        assert!(token_hint("my-org-slug").contains("must start with"));
        assert!(token_hint("019508a0-0001-7000-8000-000000000000").contains("must start with"));
        assert!(token_hint("").contains("must start with"));
    }
}
