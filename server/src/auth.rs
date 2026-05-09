use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use serde::Serialize;

#[derive(Clone)]
pub struct AuthState {
    inner: Arc<AuthStateInner>,
}

struct AuthStateInner {
    dev_token: String,
}

impl AuthState {
    pub fn new(dev_token: String) -> Self {
        Self {
            inner: Arc::new(AuthStateInner { dev_token }),
        }
    }

    fn matches(&self, token: &str) -> bool {
        // constant-time compare to avoid timing leaks
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
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorBody {
                error: "unauthorized",
            }),
        )
            .into_response();
    };

    if !state.matches(token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ErrorBody {
                error: "unauthorized",
            }),
        )
            .into_response();
    }

    next.run(req).await
}
