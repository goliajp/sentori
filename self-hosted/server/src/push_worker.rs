//! Background push dispatcher worker.
//!
//! Drains `push_sends.status = 'queued'` every 5 seconds. For each
//! send, looks up the device_token + push_credentials, invokes the
//! configured vendor adapter (APNs / FCM / WebPush / HCM / MiPush),
//! and writes a `push_delivery_logs` row + flips
//! `push_sends.status` to `sent` or `failed`.
//!
//! v0.2 step 5 only ships a permissive "ack everything" mock
//! dispatcher because the vendor adapter crates (K7.1-K7.5) are
//! still being implemented. Production swaps in the real impls.
//!
//! Tunables (env-vars):
//! - `SENTORI_PUSH_WORKER_ENABLED`: 1/true to start the worker
//!   (default: enabled)
//! - `SENTORI_PUSH_WORKER_INTERVAL_SEC`: poll interval (default 5s)
//! - `SENTORI_PUSH_WORKER_BATCH`: max sends per poll (default 100)

use std::time::Duration;

use sqlx::{PgPool, Row};
use tokio::time::sleep;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Spawn the worker as a long-running tokio task.
pub fn spawn(pool: PgPool) {
    if !env_enabled() {
        info!("push worker disabled via SENTORI_PUSH_WORKER_ENABLED");
        return;
    }
    let interval = env_interval();
    let batch = env_batch();
    tokio::spawn(async move {
        info!(interval_sec = interval.as_secs(), batch, "push worker started");
        loop {
            match drain_once(&pool, batch).await {
                Ok(0) => debug!("push worker idle"),
                Ok(n) => info!(processed = n, "push worker drained batch"),
                Err(e) => warn!(error = %e, "push worker batch failed"),
            }
            sleep(interval).await;
        }
    });
}

async fn drain_once(pool: &PgPool, batch: usize) -> Result<usize, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, token_id, provider, payload FROM push_sends \
         WHERE status = 'queued' AND next_attempt_at <= now() \
         ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED",
    )
    .bind(batch as i64)
    .fetch_all(pool)
    .await?;
    if rows.is_empty() {
        return Ok(0);
    }
    let mut processed = 0;
    for r in &rows {
        let send_id: Uuid = r.get("id");
        let provider: String = r.get("provider");
        if let Err(e) = dispatch_one(pool, send_id, &provider).await {
            warn!(%send_id, error = %e, "push send dispatch failed");
            continue;
        }
        processed += 1;
    }
    Ok(processed)
}

async fn dispatch_one(pool: &PgPool, send_id: Uuid, provider: &str) -> Result<(), sqlx::Error> {
    // v0.2 step 5: mock-success dispatcher. Replace with real
    // vendor adapter via push-provider's PushDispatcher in step 6+.
    let (status, outcome) = mock_send(provider);

    // INSERT log row.
    sqlx::query(
        "INSERT INTO push_delivery_logs (id, send_id, attempt, outcome, provider_status, duration_ms) \
         VALUES ($1, $2, 1, $3, $4, $5)",
    )
    .bind(Uuid::now_v7())
    .bind(send_id)
    .bind(outcome)
    .bind(200i32)
    .bind(50i32)
    .execute(pool)
    .await?;

    // UPDATE send row.
    sqlx::query(
        "UPDATE push_sends SET status = $1, provider_outcome = $2, sent_at = now() \
         WHERE id = $3",
    )
    .bind(status)
    .bind(outcome)
    .bind(send_id)
    .execute(pool)
    .await?;

    Ok(())
}

fn mock_send(provider: &str) -> (&'static str, &'static str) {
    // For now every push "succeeds" — same shape as a real provider
    // would write upon 200 OK + valid token.
    let _ = provider;
    ("sent", "ok")
}

fn env_enabled() -> bool {
    matches!(
        std::env::var("SENTORI_PUSH_WORKER_ENABLED")
            .ok()
            .as_deref()
            .map(|s| s.to_ascii_lowercase()),
        Some(s) if s == "1" || s == "true"
    ) || std::env::var("SENTORI_PUSH_WORKER_ENABLED").is_err()
}

fn env_interval() -> Duration {
    let secs = std::env::var("SENTORI_PUSH_WORKER_INTERVAL_SEC")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(5);
    Duration::from_secs(secs)
}

fn env_batch() -> usize {
    std::env::var("SENTORI_PUSH_WORKER_BATCH")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(100)
}
