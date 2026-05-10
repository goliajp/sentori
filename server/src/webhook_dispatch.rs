// Phase 29 sub-B: persistent webhook retry queue dispatcher.
//
// `notifier::AlertFired` enqueues a row into `webhook_deliveries` via
// `webhook::enqueue`. This module's `spawn_cron` loop wakes every 30s,
// picks up pending rows whose `next_attempt_at` has elapsed, and calls
// `webhook::send`. The outcome shapes the row:
//
//   - 2xx                 → status='delivered', delivered_at=now()
//   - non-2xx or net err  → attempt += 1; if < MAX_ATTEMPTS, push
//                           next_attempt_at by RETRY_SCHEDULE_SECS,
//                           otherwise status='failed'.
//
// MAX_ATTEMPTS = 6 with delays [60s, 5m, 30m, 2h, 12h] mean the 6th
// attempt is the cutoff — after the 6th failure the row freezes as
// failed. The 24h slot in the schedule is reserved for a future
// extension; today the cutoff is sooner than the schedule's tail.

use std::time::Duration;

use sqlx::PgPool;
use uuid::Uuid;

const SWEEP_INTERVAL_SECS: u64 = 30;
const SWEEP_BATCH_SIZE: i64 = 50;

/// Delays between attempts, in seconds. Index N maps to "the delay
/// applied after fail #N+1 if a retry is allowed."
///   index 0 → 60s     (after fail #1)
///   index 1 → 5m      (after fail #2)
///   index 2 → 30m     (after fail #3)
///   index 3 → 2h      (after fail #4)
///   index 4 → 12h     (after fail #5)
///   index 5 → 24h     (reserved; today never reached because the
///                      MAX_ATTEMPTS cutoff fires earlier)
const RETRY_SCHEDULE_SECS: [i32; 6] = [60, 300, 1800, 7200, 43200, 86400];

const MAX_ATTEMPTS: i32 = 6;

pub fn spawn_cron(pool: PgPool) {
    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(Duration::from_secs(SWEEP_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if let Err(e) = sweep_once(&pool).await {
                tracing::warn!(error = %e, "webhook dispatch sweep failed");
            }
        }
    });
}

#[derive(sqlx::FromRow)]
struct PendingRow {
    id: Uuid,
    rule_id: Uuid,
    payload: serde_json::Value,
    target_url: String,
    secret: String,
    attempt: i32,
}

/// One sweep: pick up to SWEEP_BATCH_SIZE pending rows whose
/// `next_attempt_at` has elapsed and process each. Exposed for the
/// integration tests so they can drive the queue deterministically
/// without waiting for the 30s interval.
pub async fn sweep_once(pool: &PgPool) -> Result<(), anyhow::Error> {
    let rows: Vec<PendingRow> = sqlx::query_as(
        "SELECT id, rule_id, payload, target_url, secret, attempt \
         FROM webhook_deliveries \
         WHERE status = 'pending' AND next_attempt_at <= now() \
         ORDER BY next_attempt_at \
         LIMIT $1",
    )
    .bind(SWEEP_BATCH_SIZE)
    .fetch_all(pool)
    .await?;
    for row in rows {
        process_one(pool, row).await;
    }
    Ok(())
}

async fn process_one(pool: &PgPool, row: PendingRow) {
    let body = match serde_json::to_vec(&row.payload) {
        Ok(b) => b,
        Err(e) => {
            mark_failure(
                pool,
                row.id,
                row.attempt,
                None,
                Some(format!("serialize: {e}")),
            )
            .await;
            return;
        }
    };
    let delivery = crate::webhook::WebhookDelivery {
        event: "alert.fired",
        url: row.target_url.clone(),
        secret: row.secret.clone(),
        body,
    };
    match crate::webhook::send(&delivery).await {
        Ok(status) if status.is_success() => {
            tracing::info!(
                delivery_id = %row.id,
                rule_id = %row.rule_id,
                attempt = row.attempt + 1,
                status = %status,
                "webhook delivered",
            );
            let _ = sqlx::query(
                "UPDATE webhook_deliveries \
                 SET status = 'delivered', \
                     attempt = attempt + 1, \
                     last_status = $1, \
                     last_error = NULL, \
                     delivered_at = now() \
                 WHERE id = $2",
            )
            .bind(status.as_u16() as i32)
            .bind(row.id)
            .execute(pool)
            .await;
        }
        Ok(status) => {
            mark_failure(
                pool,
                row.id,
                row.attempt,
                Some(status.as_u16() as i32),
                None,
            )
            .await;
        }
        Err(e) => {
            mark_failure(pool, row.id, row.attempt, None, Some(e.to_string()))
                .await;
        }
    }
}

async fn mark_failure(
    pool: &PgPool,
    id: Uuid,
    old_attempt: i32,
    last_status: Option<i32>,
    last_error: Option<String>,
) {
    let new_attempt = old_attempt + 1;
    if new_attempt >= MAX_ATTEMPTS {
        tracing::warn!(
            delivery_id = %id,
            attempt = new_attempt,
            ?last_status,
            ?last_error,
            "webhook permanently failed",
        );
        let _ = sqlx::query(
            "UPDATE webhook_deliveries \
             SET status = 'failed', \
                 attempt = $1, \
                 last_status = $2, \
                 last_error = $3 \
             WHERE id = $4",
        )
        .bind(new_attempt)
        .bind(last_status)
        .bind(last_error)
        .bind(id)
        .execute(pool)
        .await;
        return;
    }
    let delay_secs = RETRY_SCHEDULE_SECS[(new_attempt as usize) - 1];
    tracing::warn!(
        delivery_id = %id,
        attempt = new_attempt,
        delay_secs,
        ?last_status,
        ?last_error,
        "webhook attempt failed, scheduling retry",
    );
    let _ = sqlx::query(
        "UPDATE webhook_deliveries \
         SET attempt = $1, \
             next_attempt_at = now() + make_interval(secs => $2), \
             last_status = $3, \
             last_error = $4 \
         WHERE id = $5",
    )
    .bind(new_attempt)
    .bind(delay_secs)
    .bind(last_status)
    .bind(last_error)
    .bind(id)
    .execute(pool)
    .await;
}
