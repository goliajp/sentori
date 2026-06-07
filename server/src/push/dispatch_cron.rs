// v2.7 — push dispatch cron.
//
// Mirrors `webhook_dispatch::spawn_cron`: a tokio task ticks every
// 30s, claims up to 50 queued rows whose `next_attempt_at <= now()`,
// and processes each via the matching provider.
//
// Per-row pipeline:
//   1. JOIN push_sends with device_tokens + push_credentials to get
//      everything needed in one query (native_token, env, provider
//      config, encrypted secret).
//   2. Decrypt secret via `secrets::open`.
//   3. Dispatch via the matching provider trait.
//   4. Match outcome:
//        Sent                       → status='sent', sent_at=now(),
//                                     bad_streak=0
//        PermanentlyInvalidToken    → status='failed';
//                                     device_tokens.bad_streak += 1;
//                                     at threshold (3) → revoke device.
//        EnvironmentMismatch        → status='failed' (operator must
//                                     re-register on the correct env).
//        Transient(retry_after)     → if retry_count < MAX_ATTEMPTS,
//                                     bump retry_count + push
//                                     next_attempt_at by either the
//                                     provider's hint or the schedule;
//                                     otherwise → status='failed'.
//        TerminalOther              → status='failed'.
//   5. Insert one row into push_delivery_logs per attempt.

use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use uuid::Uuid;

use crate::push::providers::{ProviderKind, Providers, SendOutcome};
use crate::push::types::NativeMessage;

const SWEEP_INTERVAL_SECS: u64 = 30;
const SWEEP_BATCH_SIZE: i64 = 50;

/// Delays between attempts, in seconds. Same shape as
/// `webhook_dispatch::RETRY_SCHEDULE_SECS`.
const RETRY_SCHEDULE_SECS: [i32; 6] = [60, 300, 1800, 7200, 43200, 86400];

const MAX_ATTEMPTS: i32 = 6;
const BAD_STREAK_THRESHOLD: i32 = 3;

/// Cron handle: pool + provider registry + master secret for
/// decrypting push_credentials secret_blob rows.
#[derive(Clone)]
pub struct DispatchHandle {
    pub pool: PgPool,
    pub providers: Arc<Providers>,
    pub master_secret: Arc<Vec<u8>>,
}

impl DispatchHandle {
    pub fn new(pool: PgPool, providers: Arc<Providers>, master_secret: Vec<u8>) -> Self {
        Self {
            pool,
            providers,
            master_secret: Arc::new(master_secret),
        }
    }
}

pub fn spawn_cron(handle: DispatchHandle) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(SWEEP_INTERVAL_SECS));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            interval.tick().await;
            if let Err(e) = sweep_once(&handle).await {
                tracing::warn!(error = %e, "push dispatch sweep failed");
            }
        }
    });
}

#[derive(sqlx::FromRow)]
struct PendingRow {
    send_id: Uuid,
    #[allow(dead_code)]
    project_id: Uuid,
    token_id: Uuid,
    provider: String,
    payload: serde_json::Value,
    retry_count: i32,
    native_token: String,
    env: Option<String>,
    config: serde_json::Value,
    secret_blob: Vec<u8>,
    secret_nonce: Vec<u8>,
}

/// One sweep. Exposed `pub` for integration tests so they can drive
/// the queue deterministically without waiting for the 30s tick.
pub async fn sweep_once(handle: &DispatchHandle) -> Result<(), anyhow::Error> {
    let rows: Vec<PendingRow> = sqlx::query_as(
        "SELECT s.id AS send_id, s.project_id, s.token_id, s.provider, s.payload, s.retry_count, \
                d.native_token, d.env, c.config, c.secret_blob, c.secret_nonce \
         FROM push_sends s \
         JOIN device_tokens d ON d.id = s.token_id \
         LEFT JOIN push_credentials c \
                ON c.project_id = s.project_id AND c.provider = s.provider \
         WHERE s.status = 'queued' AND s.next_attempt_at <= now() \
         ORDER BY s.next_attempt_at \
         LIMIT $1",
    )
    .bind(SWEEP_BATCH_SIZE)
    .fetch_all(&handle.pool)
    .await?;
    for row in rows {
        process_one(handle, row).await;
    }
    Ok(())
}

async fn process_one(handle: &DispatchHandle, row: PendingRow) {
    let attempt = row.retry_count + 1;
    let Some(kind) = ProviderKind::from_db(&row.provider) else {
        mark_failed(
            handle,
            row.send_id,
            "InvalidProvider",
            &format!("unknown provider '{}'", row.provider),
            attempt,
            None,
            None,
            0,
        )
        .await;
        return;
    };

    // Reject sends where the project has no credentials configured
    // for that provider. We mark these as 'failed' immediately rather
    // than queue indefinitely — caller needs to set up credentials.
    if row.secret_blob.is_empty() {
        mark_failed(
            handle,
            row.send_id,
            "CredentialMissing",
            &format!("no credentials configured for project_id+{kind:?}"),
            attempt,
            None,
            None,
            0,
        )
        .await;
        return;
    }

    let secret_payload =
        match crate::secrets::open(&handle.master_secret, &row.secret_blob, &row.secret_nonce) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(error = %e, send_id = %row.send_id, "cred decrypt failed");
                mark_failed(
                    handle,
                    row.send_id,
                    "CredentialDecryptFailed",
                    "secret_blob decryption failed",
                    attempt,
                    None,
                    None,
                    0,
                )
                .await;
                return;
            }
        };

    let msg: NativeMessage = match serde_json::from_value(row.payload.clone()) {
        Ok(m) => m,
        Err(e) => {
            mark_failed(
                handle,
                row.send_id,
                "PayloadCorrupt",
                &format!("payload deserialize: {e}"),
                attempt,
                None,
                None,
                0,
            )
            .await;
            return;
        }
    };

    let provider = handle.providers.pick(kind);
    let cred = crate::push::providers::Credential {
        config: &row.config,
        secret_payload: &secret_payload,
    };
    let result = provider
        .send(cred, &row.native_token, row.env.as_deref(), &msg)
        .await;

    match result {
        Ok(provider_result) => {
            apply_outcome(
                handle,
                row.send_id,
                row.token_id,
                attempt,
                provider_result.outcome.clone(),
                Some(provider_result.provider_outcome_label.as_str()),
                provider_result.provider_status,
                provider_result.provider_body.as_deref(),
                provider_result.duration_ms,
            )
            .await;
        }
        Err(e) => {
            tracing::warn!(error = %e, send_id = %row.send_id, "provider error");
            // Provider-layer errors (transport, malformed cred): treat
            // as transient with no retry-after hint so they reuse the
            // backoff schedule.
            let outcome = SendOutcome::Transient { retry_after_secs: None };
            apply_outcome(
                handle,
                row.send_id,
                row.token_id,
                attempt,
                outcome,
                Some("ProviderError"),
                None,
                Some(&format!("{e}")),
                0,
            )
            .await;
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn apply_outcome(
    handle: &DispatchHandle,
    send_id: Uuid,
    token_id: Uuid,
    attempt: i32,
    outcome: SendOutcome,
    label: Option<&str>,
    provider_status: Option<i32>,
    provider_body: Option<&str>,
    duration_ms: i32,
) {
    let _ = log_attempt(
        handle,
        send_id,
        attempt,
        &format!("{outcome:?}"),
        provider_status,
        provider_body,
        duration_ms,
    )
    .await;

    match outcome {
        SendOutcome::Sent => {
            mark_sent(handle, send_id, token_id, label).await;
        }
        SendOutcome::PermanentlyInvalidToken => {
            mark_failed(
                handle,
                send_id,
                label.unwrap_or("PermanentlyInvalidToken"),
                "device token invalid",
                attempt,
                None,
                None,
                duration_ms,
            )
            .await;
            bump_bad_streak(handle, token_id).await;
        }
        SendOutcome::EnvironmentMismatch => {
            mark_failed(
                handle,
                send_id,
                label.unwrap_or("EnvironmentMismatch"),
                "wrong sandbox/production environment",
                attempt,
                None,
                None,
                duration_ms,
            )
            .await;
        }
        SendOutcome::Transient { retry_after_secs } => {
            if attempt >= MAX_ATTEMPTS {
                mark_failed(
                    handle,
                    send_id,
                    label.unwrap_or("ExceededRetries"),
                    &format!("max attempts ({MAX_ATTEMPTS}) reached"),
                    attempt,
                    None,
                    None,
                    duration_ms,
                )
                .await;
                return;
            }
            // attempt index is 1-based; convert to 0-based for the
            // schedule table. Use the provider's hint if set, else
            // the schedule entry.
            let idx = ((attempt - 1) as usize).min(RETRY_SCHEDULE_SECS.len() - 1);
            let delay = retry_after_secs
                .unwrap_or(RETRY_SCHEDULE_SECS[idx])
                .max(1);
            schedule_retry(handle, send_id, attempt, delay).await;
        }
        SendOutcome::TerminalOther { reason } => {
            mark_failed(
                handle,
                send_id,
                label.unwrap_or("TerminalOther"),
                &reason,
                attempt,
                None,
                None,
                duration_ms,
            )
            .await;
        }
    }
}

async fn mark_sent(
    handle: &DispatchHandle,
    send_id: Uuid,
    token_id: Uuid,
    label: Option<&str>,
) {
    let _ = sqlx::query(
        "UPDATE push_sends SET status='sent', sent_at=now(), provider_outcome=$2, retry_count=retry_count+1 \
         WHERE id=$1",
    )
    .bind(send_id)
    .bind(label.unwrap_or("Sent"))
    .execute(&handle.pool)
    .await;
    // Reset bad streak on success.
    let _ = sqlx::query("UPDATE device_tokens SET bad_streak=0, last_seen_at=now() WHERE id=$1")
        .bind(token_id)
        .execute(&handle.pool)
        .await;
}

#[allow(clippy::too_many_arguments)]
async fn mark_failed(
    handle: &DispatchHandle,
    send_id: Uuid,
    label: &str,
    error: &str,
    _attempt: i32,
    _provider_status: Option<i32>,
    _provider_body: Option<&str>,
    _duration_ms: i32,
) {
    let _ = sqlx::query(
        "UPDATE push_sends SET status='failed', provider_outcome=$2, error=$3, retry_count=retry_count+1 \
         WHERE id=$1",
    )
    .bind(send_id)
    .bind(label)
    .bind(error)
    .execute(&handle.pool)
    .await;
}

async fn schedule_retry(handle: &DispatchHandle, send_id: Uuid, attempt: i32, delay_secs: i32) {
    let _ = sqlx::query(
        "UPDATE push_sends SET retry_count=$2, next_attempt_at = now() + ($3 || ' seconds')::interval \
         WHERE id=$1",
    )
    .bind(send_id)
    .bind(attempt)
    .bind(delay_secs.to_string())
    .execute(&handle.pool)
    .await;
}

async fn bump_bad_streak(handle: &DispatchHandle, token_id: Uuid) {
    let _ = sqlx::query(
        "UPDATE device_tokens \
         SET bad_streak = bad_streak + 1, \
             revoked_at = CASE WHEN bad_streak + 1 >= $2 THEN now() ELSE revoked_at END, \
             updated_at = now() \
         WHERE id = $1",
    )
    .bind(token_id)
    .bind(BAD_STREAK_THRESHOLD)
    .execute(&handle.pool)
    .await;
}

async fn log_attempt(
    handle: &DispatchHandle,
    send_id: Uuid,
    attempt: i32,
    outcome: &str,
    provider_status: Option<i32>,
    provider_body: Option<&str>,
    duration_ms: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO push_delivery_logs \
            (id, send_id, attempt, outcome, provider_status, provider_body, duration_ms) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(Uuid::now_v7())
    .bind(send_id)
    .bind(attempt)
    .bind(outcome)
    .bind(provider_status)
    .bind(provider_body)
    .bind(duration_ms)
    .execute(&handle.pool)
    .await?;
    Ok(())
}
