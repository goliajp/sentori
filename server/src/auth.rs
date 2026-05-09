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

#[derive(Clone)]
pub struct AuthState {
    inner: Arc<AuthStateInner>,
}

struct AuthStateInner {
    dev_token: String,
    db: Option<PgPool>,
}

impl AuthState {
    pub fn new(dev_token: String, db: Option<PgPool>) -> Self {
        Self {
            inner: Arc::new(AuthStateInner { dev_token, db }),
        }
    }

    /// Validate a token. Accepts the dev token via constant-time compare,
    /// or any token whose sha256 is found unrevoked in `tokens`.
    pub async fn validate(&self, token: &str) -> bool {
        if self.matches_dev(token) {
            return true;
        }
        if let Some(pool) = &self.inner.db {
            match self.lookup_db(pool, token).await {
                Ok(true) => return true,
                Ok(false) => {}
                Err(e) => {
                    tracing::error!(error = %e, "token DB lookup failed");
                }
            }
        }
        false
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

    async fn lookup_db(&self, pool: &PgPool, token: &str) -> Result<bool, sqlx::Error> {
        let token_hash = hash_token(token);
        let exists: Option<(uuid::Uuid,)> = sqlx::query_as(
            "SELECT id FROM tokens WHERE token_hash = $1 AND revoked_at IS NULL",
        )
        .bind(&token_hash)
        .fetch_optional(pool)
        .await?;
        Ok(exists.is_some())
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
}

pub async fn require_token(
    State(state): State<AuthState>,
    req: Request,
    next: Next,
) -> Response {
    let token = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));

    let Some(token) = token else {
        return unauthorized();
    };

    if !state.validate(token).await {
        return unauthorized();
    }

    next.run(req).await
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorBody {
            error: "unauthorized",
        }),
    )
        .into_response()
}
