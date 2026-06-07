// v2.7 — push dispatch cron.
//
// Mirrors `webhook_dispatch::spawn_cron`: a tokio task ticks every
// 30s, claims up to 50 queued rows whose `next_attempt_at <= now()`,
// and processes each via the matching provider.
//
// Retry schedule [60s, 5m, 30m, 2h, 12h, 24h] × 6 max attempts.
// Bad-token streak: on `PermanentlyInvalidToken` the token's
// `bad_streak` is bumped; at 3 it's auto-revoked.
//
// v2.7 foundation commit: the cron is wired up but every provider
// returns NotImplemented, so rows stay queued. Once APNs + FCM
// providers are filled in (W4 + W5 follow-ups), the cron starts
// actually shipping notifications. This shape lets us merge the
// foundation without surprising operators with mysterious failed
// sends.

use std::time::Duration;

use sqlx::PgPool;

const SWEEP_INTERVAL_SECS: u64 = 30;
const SWEEP_BATCH_SIZE: i64 = 50;

/// Delays between attempts, in seconds. Same shape as
/// `webhook_dispatch::RETRY_SCHEDULE_SECS`.
#[allow(dead_code)]
const RETRY_SCHEDULE_SECS: [i32; 6] = [60, 300, 1800, 7200, 43200, 86400];

#[allow(dead_code)]
const MAX_ATTEMPTS: i32 = 6;

#[allow(dead_code)]
const BAD_STREAK_THRESHOLD: i32 = 3;

pub fn spawn_cron(pool: PgPool) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(SWEEP_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if let Err(e) = sweep_once(&pool).await {
                tracing::warn!(error = %e, "push dispatch sweep failed");
            }
        }
    });
}

/// One sweep. Exposed `pub` for integration tests so they can drive
/// the queue deterministically without waiting 30s.
pub async fn sweep_once(pool: &PgPool) -> Result<(), anyhow::Error> {
    let _rows: Vec<(uuid::Uuid,)> = sqlx::query_as(
        "SELECT id FROM push_sends \
         WHERE status = 'queued' AND next_attempt_at <= now() \
         ORDER BY next_attempt_at \
         LIMIT $1",
    )
    .bind(SWEEP_BATCH_SIZE)
    .fetch_all(pool)
    .await?;
    // v2.7 foundation: the per-row dispatch loop is the W4/W5/W6
    // follow-up. Today we just measure that the sweep query
    // doesn't blow up.
    Ok(())
}
