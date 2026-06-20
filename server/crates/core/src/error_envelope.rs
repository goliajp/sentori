//! F2 — response-rewrite middleware that converts plain-text or empty
//! 4xx/5xx responses (typically from tower-http's body-limit layer)
//! into the structured error envelope `ErrorBodyV2`.
//!
//! Handlers that already return a structured `{ error: {...} }` JSON
//! body pass through unchanged. Detection is best-effort: if
//! `Content-Type` is JSON we assume it's already structured.

use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::Response,
};

use crate::correlation_id;

pub async fn structured_error_responses(req: Request, next: Next) -> Response {
    let resp = next.run(req).await;
    let status = resp.status();
    if status.as_u16() < 400 {
        return resp;
    }

    // If content-type says JSON, assume the handler already produced a
    // structured body. We don't want to double-wrap.
    if let Some(ct) = resp.headers().get(header::CONTENT_TYPE) {
        if let Ok(s) = ct.to_str() {
            if s.contains("application/json") {
                return resp;
            }
        }
    }

    let (parts, body) = resp.into_parts();
    let bytes = axum::body::to_bytes(body, 64 * 1024)
        .await
        .unwrap_or_default();
    let original_text = String::from_utf8_lossy(&bytes).to_string();

    let (code, message, layer) = classify(parts.status, &original_text);
    let new_body = crate::error::err_response(
        parts.status,
        code,
        message,
        layer,
    );

    // We want to preserve any extra headers tower set (Content-Length
    // will get rewritten; cors, X-Sentori-Correlation-Id, etc. need
    // to survive). Merge new body's headers onto parts.headers, with
    // ours winning on content-type / length.
    let (new_parts, new_body_part) = new_body.into_parts();
    let mut merged = parts;
    merged.status = new_parts.status;
    for (k, v) in new_parts.headers.iter() {
        merged.headers.insert(k.clone(), v.clone());
    }
    Response::from_parts(merged, Body::new(new_body_part))
}

fn classify(status: StatusCode, body: &str) -> (&'static str, String, &'static str) {
    let lower = body.to_lowercase();
    match status.as_u16() {
        413 => (
            "body.tooLarge",
            "request body exceeds the per-route cap".to_string(),
            "axum.body_limit",
        ),
        400 if lower.contains("invalid")
            || lower.contains("malformed")
            || lower.contains("missing")
            || lower.contains("expected") =>
        {
            (
                "body.malformed",
                if body.is_empty() {
                    "request body is malformed".to_string()
                } else {
                    body.trim().to_string()
                },
                "parser",
            )
        }
        404 => (
            "domain.notFound",
            "no such resource".to_string(),
            "domain",
        ),
        405 => (
            "transport.methodNotAllowed",
            "method not allowed on this route".to_string(),
            "transport",
        ),
        500 => (
            "internal.unexpected",
            "unexpected server error".to_string(),
            "internal",
        ),
        s if s >= 500 => (
            "internal.upstream",
            "upstream / dependency failure".to_string(),
            "internal",
        ),
        _ => (
            "transport.error",
            format!("HTTP {} from server", status.as_u16()),
            "transport",
        ),
    }
}

// Re-export for the `IntoResponse` impl above so we can plug it into
// the middleware chain via `axum::middleware::from_fn`.
#[allow(dead_code)]
pub fn current_cid() -> uuid::Uuid {
    correlation_id::current()
}
