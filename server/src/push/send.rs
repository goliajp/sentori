// v2.7 — send enqueue.
//
// `POST /v1/push/send` accepts a NativeMessage (single or array
// recipient). For each recipient:
//   1. Resolve `ipt_<uuid>` to a device_tokens row (project-scoped).
//   2. Insert a push_sends row with status='queued' and
//      next_attempt_at=now().
//   3. Return a Ticket. The dispatcher cron picks up the row on
//      its next sweep (≤30s) and runs the provider call.
//
// Idempotency: if NativeMessage.idempotency_key is set and a row
// already exists at (project, key), return the existing ticket
// instead of creating a new one. Provided per-project, not per-
// token — that's a deliberate choice: "I sent comment notification
// for comment_abc" is the operator's intent, not "I sent comment_abc
// to user 1, then to user 2".

use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::push::types::{format_send_id, parse_token_handle, NativeMessage, SendStatus, Ticket};

#[derive(Debug, Error)]
pub enum SendError {
    #[error("device token not found or revoked: {0}")]
    TokenNotFound(String),
    #[error("invalid token handle: {0}")]
    InvalidTokenHandle(String),
    #[error("database error")]
    Database(#[from] sqlx::Error),
}

/// Enqueue a send for every recipient. Returns one Ticket per
/// recipient, in input order.
/// v2.33 — strict-paired hex decoder. Returns None on odd length or
/// non-hex chars. We avoid `hex` crate to keep the dep surface tight.
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    for chunk in bytes.chunks_exact(2) {
        let hi = (chunk[0] as char).to_digit(16)?;
        let lo = (chunk[1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
    }
    Some(out)
}

pub async fn enqueue_send(
    pool: &PgPool,
    project_id: Uuid,
    msg: &NativeMessage,
) -> Result<Vec<Ticket>, SendError> {
    // v2.33 — user fanout. When `to: { userFingerprintHex }` we
    // resolve to every active device the user has registered in
    // this project. Empty set returns empty tickets (no error).
    if let Some(fp_hex) = msg.to.as_user_fingerprint() {
        let fp_bytes = match hex_decode(fp_hex) {
            Some(b) => b,
            None => return Err(SendError::InvalidTokenHandle(fp_hex.to_string())),
        };
        let token_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM device_tokens \
             WHERE project_id = $1 \
               AND user_fingerprint_hex = $2 \
               AND revoked_at IS NULL",
        )
        .bind(project_id)
        .bind(&fp_bytes)
        .fetch_all(pool)
        .await?;
        let mut tickets = Vec::with_capacity(token_ids.len());
        for token_uuid in token_ids {
            let ticket = enqueue_one(pool, project_id, token_uuid, msg).await?;
            tickets.push(ticket);
        }
        return Ok(tickets);
    }

    // v2.31 — topic fanout. When `to: { topic }` we resolve to every
    // active device subscribed to that topic in this project, then
    // delegate to the per-token enqueue loop. Empty subscriber set
    // returns empty tickets (no error).
    if let Some(topic) = msg.to.as_topic() {
        let token_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT d.id FROM device_tokens d \
             JOIN device_topics t ON t.device_token_id = d.id \
             WHERE d.project_id = $1 \
               AND d.revoked_at IS NULL \
               AND t.topic = $2",
        )
        .bind(project_id)
        .bind(topic)
        .fetch_all(pool)
        .await?;
        let mut tickets = Vec::with_capacity(token_ids.len());
        for token_uuid in token_ids {
            let ticket = enqueue_one(pool, project_id, token_uuid, msg).await?;
            tickets.push(ticket);
        }
        return Ok(tickets);
    }

    let recipients = msg.to.as_vec();
    let mut tickets = Vec::with_capacity(recipients.len());
    for recipient in recipients {
        let token_uuid = parse_token_handle(&recipient)
            .ok_or_else(|| SendError::InvalidTokenHandle(recipient.clone()))?;
        let ticket = enqueue_one(pool, project_id, token_uuid, msg).await?;
        tickets.push(ticket);
    }
    Ok(tickets)
}

async fn enqueue_one(
    pool: &PgPool,
    project_id: Uuid,
    token_uuid: Uuid,
    msg: &NativeMessage,
) -> Result<Ticket, SendError> {
    // Idempotency short-circuit. If a row already exists at
    // (project, idempotency_key), return its current state instead
    // of inserting a fresh row.
    if let Some(key) = msg.idempotency_key.as_deref() {
        let existing = sqlx::query_as::<_, ExistingSend>(
            "SELECT id, status, provider_outcome, error, retry_count, created_at, sent_at \
             FROM push_sends \
             WHERE project_id = $1 AND idempotency_key = $2",
        )
        .bind(project_id)
        .bind(key)
        .fetch_optional(pool)
        .await?;
        if let Some(row) = existing {
            return Ok(Ticket {
                id: format_send_id(row.id),
                status: SendStatus::from_db(&row.status),
                provider_outcome: row.provider_outcome,
                error: row.error,
                retry_count: row.retry_count,
                created_at: row.created_at,
                sent_at: row.sent_at,
            });
        }
    }
    // Resolve the device token row + capture its provider for the
    // push_sends row (denormalised so the dispatcher doesn't need
    // a JOIN). Reject revoked rows up front.
    let token_row = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id, provider FROM device_tokens \
         WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL",
    )
    .bind(token_uuid)
    .bind(project_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| SendError::TokenNotFound(token_uuid.to_string()))?;
    let send_uuid = Uuid::now_v7();
    let payload = serde_json::to_value(msg)
        .map_err(|e| SendError::Database(sqlx::Error::Decode(Box::new(e))))?;
    // v2.25 — three optional BI tags (campaign / template / audience)
    // land alongside the existing idempotency_key column. Migration
    // 0079 created the columns nullable + index on campaign_id.
    // v2.32 — when `send_at` is set, schedule the row by clamping
    // next_attempt_at to GREATEST(now(), send_at). Past timestamps
    // collapse to "send now". The existing dispatch_cron filter
    // (`next_attempt_at <= now()`) naturally holds the row until
    // the time arrives.
    let row = sqlx::query_as::<_, (Uuid, String, time::OffsetDateTime)>(
        "INSERT INTO push_sends \
            (id, project_id, token_id, provider, payload, idempotency_key, \
             campaign_id, template_id, audience_tag, next_attempt_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, \
                 GREATEST(now(), COALESCE($10::TIMESTAMPTZ, now()))) \
         RETURNING id, status, created_at",
    )
    .bind(send_uuid)
    .bind(project_id)
    .bind(token_row.0)
    .bind(&token_row.1)
    .bind(payload)
    .bind(msg.idempotency_key.as_deref())
    .bind(msg.campaign_id.as_deref())
    .bind(msg.template_id.as_deref())
    .bind(msg.audience_tag.as_deref())
    .bind(msg.send_at)
    .fetch_one(pool)
    .await?;
    Ok(Ticket {
        id: format_send_id(row.0),
        status: SendStatus::from_db(&row.1),
        provider_outcome: None,
        error: None,
        retry_count: 0,
        created_at: row.2,
        sent_at: None,
    })
}

#[derive(sqlx::FromRow)]
struct ExistingSend {
    id: Uuid,
    status: String,
    provider_outcome: Option<String>,
    error: Option<String>,
    retry_count: i32,
    created_at: time::OffsetDateTime,
    sent_at: Option<time::OffsetDateTime>,
}
