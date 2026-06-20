// Phase 37 sub-A: axum middleware that emits an `http.server` span
// for every request handled by sentori-server. The emitted spans are
// pushed onto `SpanEmitter`'s buffer (see `trace_emit.rs`) and
// flushed in batches to the spans / traces tables, so the dashboard's
// trace list eventually shows sentori-server's own request handling.

use axum::{extract::Request, http::HeaderValue, middleware::Next, response::Response};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::trace_emit::{EmitSpan, SpanEmitter, parse_traceparent};

pub async fn tracing_middleware(emitter: SpanEmitter, req: Request, next: Next) -> Response {
    // Snapshot identifiers before next.run() consumes the request.
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let traceparent = req
        .headers()
        .get("traceparent")
        .and_then(|h: &HeaderValue| h.to_str().ok())
        .map(String::from);

    let (trace_id, parent_span_id) = match traceparent.as_deref().and_then(parse_traceparent) {
        Some((t, p)) => (t, Some(p)),
        None => (Uuid::now_v7(), None),
    };
    let span_id = Uuid::now_v7();
    let started_at = OffsetDateTime::now_utc();
    let started = std::time::Instant::now();

    let response = next.run(req).await;

    let duration_ms = started.elapsed().as_millis().min(i32::MAX as u128) as i32;
    let status_code = response.status();
    let span_status = if status_code.is_server_error() {
        "error"
    } else if status_code.is_client_error() {
        // 4xx is a client mistake, not a server failure. Don't poison
        // the trace status; the dashboard's filter chips can still find
        // these via tags.http.status if needed.
        "ok"
    } else {
        "ok"
    };

    emitter.try_push(EmitSpan {
        id: span_id,
        trace_id,
        parent_span_id,
        op: "http.server".into(),
        name: format!("{} {}", method.as_str(), path),
        started_at,
        duration_ms,
        status: span_status.into(),
        tags: json!({
            "http.method": method.as_str(),
            "http.path": path,
            "http.status": status_code.as_u16().to_string(),
        }),
    });

    response
}
