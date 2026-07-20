//! Stripe webhook ingest using S5 stripe-webhook-verify.

use sentori_stripe_webhook_verify::{Tolerance, verify};
use sqlx::PgPool;
use uuid::Uuid;

/// Verify + persist one Stripe webhook delivery to the
/// `stripe_events` ledger. Returns Ok(true) when newly
/// recorded, Ok(false) when the event id was already seen
/// (dedup hit — caller returns 200 to Stripe so retries
/// stop).
///
/// # Errors
///
/// - String on signature verification failure (caller
///   responds 400; do NOT persist on bad sig).
/// - [`sqlx::Error`] on DB failure.
pub async fn ingest_webhook(
    pool: &PgPool,
    body: &[u8],
    sig_header: &str,
    secret: &str,
    now_unix: i64,
) -> anyhow::Result<bool> {
    let _verified = verify(
        secret.as_bytes(),
        sig_header,
        body,
        now_unix,
        Tolerance::default(),
    )
    .map_err(|e| anyhow::anyhow!("stripe sig verify: {e}"))?;
    let payload: serde_json::Value = serde_json::from_slice(body)
        .map_err(|e| anyhow::anyhow!("malformed Stripe payload JSON: {e}"))?;
    let stripe_event_id = payload
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Stripe event payload missing `id`"))?;
    let event_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

    let inserted: Option<(Uuid,)> = sqlx::query_as(
        r"
        INSERT INTO stripe_events (id, stripe_event_id, event_type, payload)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (stripe_event_id) DO NOTHING
        RETURNING id
        ",
    )
    .bind(Uuid::now_v7())
    .bind(stripe_event_id)
    .bind(event_type)
    .bind(&payload)
    .fetch_optional(pool)
    .await?;
    Ok(inserted.is_some())
}
