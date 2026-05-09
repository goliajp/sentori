use axum::{
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use serde_json::json;

use crate::recent::AppState;

/// Per-token sliding-fixed-window rate limit (1 minute buckets).
/// Fail-open: if Valkey is unavailable, requests pass through.
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let valkey = match &state.valkey {
        Some(v) => v.clone(),
        None => return next.run(req).await,
    };

    let token_hash = match extract_token_hash(&req) {
        Some(h) => h,
        None => return next.run(req).await,
    };

    match check_rate_limit(valkey, &token_hash, state.rate_limit_per_min).await {
        Ok(RateLimitResult::Ok) => next.run(req).await,
        Ok(RateLimitResult::Limited { retry_after_ms }) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(
                header::RETRY_AFTER,
                ((retry_after_ms / 1000) + 1).to_string(),
            )],
            Json(json!({
                "error": "rateLimited",
                "retryAfterMs": retry_after_ms,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "rate limit check failed; failing open");
            next.run(req).await
        }
    }
}

fn extract_token_hash(req: &Request) -> Option<String> {
    let header = req.headers().get(header::AUTHORIZATION)?;
    let s = header.to_str().ok()?;
    let token = s.strip_prefix("Bearer ")?;
    Some(crate::auth::hash_token(token))
}

const AUTH_LIMIT_PER_MIN: u32 = 30;

/// Per-IP rate limit for unauthenticated auth endpoints (register / login).
/// Uses X-Forwarded-For when present (production behind a reverse proxy);
/// otherwise buckets all callers under "unknown" — sufficient for dev.
pub async fn rate_limit_auth_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let valkey = match &state.valkey {
        Some(v) => v.clone(),
        None => return next.run(req).await,
    };

    let ip = extract_ip(&req);
    let key = format!("auth:{ip}");

    match check_rate_limit(valkey, &key, AUTH_LIMIT_PER_MIN).await {
        Ok(RateLimitResult::Ok) => next.run(req).await,
        Ok(RateLimitResult::Limited { retry_after_ms }) => (
            StatusCode::TOO_MANY_REQUESTS,
            [(
                header::RETRY_AFTER,
                ((retry_after_ms / 1000) + 1).to_string(),
            )],
            Json(json!({
                "error": "rateLimited",
                "retryAfterMs": retry_after_ms,
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "auth rate limit failed; failing open");
            next.run(req).await
        }
    }
}

fn extract_ip(req: &Request) -> String {
    req.headers()
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

enum RateLimitResult {
    Ok,
    Limited { retry_after_ms: u64 },
}

async fn check_rate_limit(
    mut conn: ConnectionManager,
    key_prefix: &str,
    limit: u32,
) -> Result<RateLimitResult, redis::RedisError> {
    let bucket = current_minute_bucket();
    let key = format!("rl:{key_prefix}:{bucket}");

    let count: u32 = conn.incr(&key, 1u32).await?;
    if count == 1 {
        let _: () = conn.expire(&key, 60i64).await?;
    }

    if count > limit {
        Ok(RateLimitResult::Limited {
            retry_after_ms: ms_until_next_minute(),
        })
    } else {
        Ok(RateLimitResult::Ok)
    }
}

fn current_minute_bucket() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 60)
        .unwrap_or(0)
}

fn ms_until_next_minute() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let next_min = ((now_ms / 60_000) + 1) * 60_000;
    next_min - now_ms
}
