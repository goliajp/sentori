// v2.7 — receipt lookup.
//
// `GET /v1/push/receipts/{send_id}` returns the current state of
// a push_sends row. Dashboard's (v2.11) Push module lists the
// per-attempt log via push_delivery_logs; for v2.7 the public API
// only surfaces the headline ticket.

use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::push::types::{format_send_id, SendStatus, Ticket};

pub async fn get_receipt(
    pool: &PgPool,
    project_id: Uuid,
    send_id: Uuid,
) -> Result<Option<Ticket>, sqlx::Error> {
    let row = sqlx::query_as::<_, ReceiptRow>(
        "SELECT id, status, provider_outcome, error, retry_count, created_at, sent_at \
         FROM push_sends \
         WHERE id = $1 AND project_id = $2",
    )
    .bind(send_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| Ticket {
        id: format_send_id(r.id),
        status: SendStatus::from_db(&r.status),
        provider_outcome: r.provider_outcome,
        error: r.error,
        retry_count: r.retry_count,
        created_at: r.created_at,
        sent_at: r.sent_at,
    }))
}

#[derive(sqlx::FromRow)]
struct ReceiptRow {
    id: Uuid,
    status: String,
    provider_outcome: Option<String>,
    error: Option<String>,
    retry_count: i32,
    created_at: OffsetDateTime,
    sent_at: Option<OffsetDateTime>,
}
