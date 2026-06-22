//! POST /v1/saas/stripe/webhook — Stripe webhook ingest.
//!
//! Verifies signature via S5 stone, dedups via the
//! `stripe_events.stripe_event_id` UNIQUE index, returns
//! 200 to Stripe always (so Stripe stops retrying), and
//! defers actual payload processing to a background
//! worker (out-of-band per CSaas1+5 scope).

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use time::OffsetDateTime;

use crate::state::AppState;
use crate::stripe::ingest_webhook;

pub async fn ingest(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, (StatusCode, String)> {
    let Some(secret) = state.stripe_secret.as_deref() else {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "stripe webhook disabled (no SENTORI_STRIPE_WEBHOOK_SECRET configured)".into(),
        ));
    };
    let sig = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::BAD_REQUEST,
            "missing Stripe-Signature header".into(),
        ))?;
    let now_unix = OffsetDateTime::now_utc().unix_timestamp();
    let fresh = ingest_webhook(&state.pool, &body, sig, secret, now_unix)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let _ = fresh; // fresh vs dedup-hit both return 200.
    Ok(StatusCode::OK)
}
