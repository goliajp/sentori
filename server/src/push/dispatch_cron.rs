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
use crate::push::retry::{decide_retry, MAX_ATTEMPTS, RetryDecision};
use crate::push::types::NativeMessage;

const SWEEP_INTERVAL_SECS: u64 = 30;
const SWEEP_BATCH_SIZE: i64 = 50;

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
    // v2.23 — stale-token soft eviction. A device_tokens row whose
    // last `/v1/push/tokens` register/refresh is > 90 d ago is almost
    // certainly OS-revoked (uninstall, fresh install, factory reset,
    // explicit settings disable). Trying to send to it wastes a
    // dispatch slot, a delivery_log row, and a slot in the
    // invalid-rate counter that would drive auto-throttle for the
    // healthy tokens too. The row itself isn't deleted — operators
    // can still inspect via the dashboard; we just don't dispatch.
    let rows: Vec<PendingRow> = sqlx::query_as(
        "SELECT s.id AS send_id, s.project_id, s.token_id, s.provider, s.payload, s.retry_count, \
                d.native_token, d.env, c.config, c.secret_blob, c.secret_nonce \
         FROM push_sends s \
         JOIN device_tokens d ON d.id = s.token_id \
         LEFT JOIN push_credentials c \
                ON c.project_id = s.project_id AND c.provider = s.provider \
         WHERE s.status = 'queued' \
           AND s.next_attempt_at <= now() \
           AND d.revoked_at IS NULL \
           AND d.last_seen_at > now() - interval '90 days' \
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
    let project_id = row.project_id;
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

    let mut msg: NativeMessage = match serde_json::from_value(row.payload.clone()) {
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

    // v2.21 — quarantine check. If this (project, provider) tripped
    // its 5xx-streak threshold recently, defer the send by the
    // remaining quarantine window WITHOUT burning retry budget. No
    // delivery_log row written — this isn't an attempt.
    if let Some(remaining) = handle
        .providers
        .quarantine
        .quarantined(project_id, kind)
        .await
    {
        defer_for_quarantine(handle, row.send_id, remaining).await;
        return;
    }

    // v2.22 — three-layer rate limit. Layer-specific defer windows
    // (L3 1s, L1 provider 2s, L2 project 5s). Acquire returns a
    // RatePermit; we hold it across `provider.send()` and drop it
    // afterwards, releasing the L3 inflight slot.
    let _rate_permit = match handle.providers.rate_limiter.acquire(project_id, kind) {
        Ok(p) => p,
        Err(crate::push::rate_limit::RateError::GlobalInflight) => {
            defer_for_quarantine(handle, row.send_id, 1).await;
            return;
        }
        Err(crate::push::rate_limit::RateError::ProviderRateLimited(_)) => {
            defer_for_quarantine(handle, row.send_id, 2).await;
            return;
        }
        Err(crate::push::rate_limit::RateError::ProjectRateLimited(_)) => {
            defer_for_quarantine(handle, row.send_id, 5).await;
            return;
        }
    };

    // v2.25 — Observability link-through ironclad rule #4. Inject the
    // send_id into the outgoing payload under the reserved
    // `_sentori.msgId` namespace. SDK side reads in v2.26 → drops a
    // BreadcrumbType::Push + emits `sentori.push.received` tracked
    // event tagged with msgId → events.push_origin_msg_id (v2.27 FK)
    // closes the JOIN for downstream-impact correlation queries.
    // Legacy SDKs ignore unknown keys — backward compatible.
    inject_sentori_msg_id(&mut msg, row.send_id);

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
                project_id,
                kind,
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
                project_id,
                kind,
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
    project_id: Uuid,
    kind: ProviderKind,
    send_id: Uuid,
    token_id: Uuid,
    attempt: i32,
    outcome: SendOutcome,
    label: Option<&str>,
    provider_status: Option<i32>,
    provider_body: Option<&str>,
    duration_ms: i32,
) {
    // v2.21 — feed the quarantine state machine. Provider-friendly
    // ironclad rule #2.
    let quarantine = &handle.providers.quarantine;
    match &outcome {
        SendOutcome::Sent
        | SendOutcome::PermanentlyInvalidToken
        | SendOutcome::EnvironmentMismatch
        | SendOutcome::TerminalOther { .. } => {
            quarantine.note_success_or_permanent(project_id, kind).await;
        }
        SendOutcome::Transient { .. } => {
            if quarantine.note_transient_failure(project_id, kind).await {
                tracing::info!(
                    %project_id,
                    ?kind,
                    "push provider quarantine tripped — sends deferred for {}s",
                    crate::push::quarantine::QUARANTINE_DURATION.as_secs()
                );
            }
        }
    }

    // v2.23 — feed the invalid-rate health gauge. Maps each
    // SendOutcome to a HealthOutcome bucket. The 429 detection is
    // a heuristic: provider_status == 429 OR the label looks like
    // "..._429..." OR provider sent a Retry-After (smart retry
    // already used the hint). Same for timeout — we look at the
    // label since SendOutcome::Transient is opaque about cause.
    use crate::push::health::HealthOutcome;
    let health_outcome = match &outcome {
        SendOutcome::Sent => HealthOutcome::Sent,
        SendOutcome::PermanentlyInvalidToken => HealthOutcome::InvalidToken,
        SendOutcome::EnvironmentMismatch => HealthOutcome::InvalidToken,
        SendOutcome::TerminalOther { .. } => HealthOutcome::OtherTransient,
        SendOutcome::Transient { .. } => {
            if provider_status == Some(429) {
                HealthOutcome::RateLimited
            } else if label
                .map(|l| l.contains("Timeout") || l.contains("timeout"))
                .unwrap_or(false)
            {
                HealthOutcome::Timeout
            } else {
                HealthOutcome::OtherTransient
            }
        }
    };
    handle
        .providers
        .health
        .record(project_id, kind, health_outcome)
        .await;
    if matches!(health_outcome, HealthOutcome::InvalidToken)
        && handle
            .providers
            .health
            .should_auto_throttle(project_id, kind)
            .await
    {
        let rate = handle
            .providers
            .health
            .invalid_rate(project_id, kind)
            .await;
        let total = handle
            .providers
            .health
            .in_window_total(project_id, kind)
            .await;
        tracing::warn!(
            %project_id,
            ?kind,
            invalid_rate = format!("{:.1}%", rate * 100.0),
            window_total = total,
            "push invalid-rate threshold tripped — sender-reputation at risk"
        );
    }

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
            // v2.20: delegate to push::retry::decide_retry so the
            // ladder + provider hint + ±20% jitter math lives in one
            // place and is unit-tested independently.
            match decide_retry(
                &SendOutcome::Transient { retry_after_secs },
                attempt,
                retry_after_secs,
            ) {
                RetryDecision::DropPermanently => {
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
                }
                RetryDecision::Retry { after_secs } => {
                    schedule_retry(handle, send_id, attempt, after_secs).await;
                }
            }
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

/// v2.25 — inject `_sentori.msgId = <send_id>` into the outgoing
/// `NativeMessage.data` so the SDK receive path can correlate this
/// push back to the server-side `push_sends.id`. Reserved namespace —
/// `data._sentori` is documented as Sentori-only and must not be set
/// by customer code. If `data` is absent, mints a fresh JSON object.
/// If `data` is non-object (legacy customer passing a string/array),
/// we leave it alone to avoid corrupting the original payload — the
/// correlation just doesn't fire for that send.
fn inject_sentori_msg_id(msg: &mut NativeMessage, send_id: Uuid) {
    let msg_id = crate::push::types::format_send_id(send_id);
    let sentori = serde_json::json!({ "msgId": msg_id });
    match msg.data.as_mut() {
        None => {
            msg.data = Some(serde_json::json!({ "_sentori": sentori }));
        }
        Some(serde_json::Value::Object(map)) => {
            map.insert("_sentori".into(), sentori);
        }
        // data is set but not an object (e.g. legacy customer passed a
        // string). Leave it alone — better to skip the correlation than
        // to corrupt the original payload shape.
        Some(_) => {}
    }
}

/// v2.21 — defer a send by `delay_secs` seconds *without* bumping
/// `retry_count`. Used by the quarantine path: the (project, provider)
/// is temporarily unhealthy, so we wait for the quarantine window
/// rather than burn a real retry attempt.
async fn defer_for_quarantine(handle: &DispatchHandle, send_id: Uuid, delay_secs: u32) {
    let _ = sqlx::query(
        "UPDATE push_sends SET next_attempt_at = now() + ($2 || ' seconds')::interval \
         WHERE id=$1",
    )
    .bind(send_id)
    .bind(delay_secs.to_string())
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

#[cfg(test)]
mod tests {
    use serde_json::json;
    use uuid::Uuid;

    use super::*;
    use crate::push::types::{NativeMessage, NativeOptions, ToField};

    fn empty_msg() -> NativeMessage {
        NativeMessage {
            to: ToField::Single("ipt_x".into()),
            title: None,
            body: None,
            data: None,
            options: NativeOptions::default(),
            idempotency_key: None,
            send_at: None,
            preference_category: None,
            campaign_id: None,
            template_id: None,
            audience_tag: None,
        }
    }

    #[test]
    fn inject_msg_id_into_absent_data_creates_object() {
        let mut msg = empty_msg();
        let send_id = Uuid::now_v7();
        inject_sentori_msg_id(&mut msg, send_id);
        let data = msg.data.unwrap();
        let sentori = data.get("_sentori").and_then(|v| v.as_object()).unwrap();
        let want = crate::push::types::format_send_id(send_id);
        assert_eq!(sentori.get("msgId").unwrap().as_str().unwrap(), want);
    }

    #[test]
    fn inject_msg_id_preserves_existing_object_keys() {
        let mut msg = empty_msg();
        msg.data = Some(json!({ "issueId": "iss_123", "deepLink": "/x" }));
        let send_id = Uuid::now_v7();
        inject_sentori_msg_id(&mut msg, send_id);
        let data = msg.data.unwrap();
        assert_eq!(data.get("issueId").unwrap().as_str().unwrap(), "iss_123");
        assert_eq!(data.get("deepLink").unwrap().as_str().unwrap(), "/x");
        assert!(data.get("_sentori").is_some());
    }

    #[test]
    fn inject_msg_id_skips_non_object_data() {
        // Legacy customer might have passed a string. Don't corrupt
        // their payload — just skip correlation for this send.
        let mut msg = empty_msg();
        msg.data = Some(json!("plain-string-payload"));
        let send_id = Uuid::now_v7();
        inject_sentori_msg_id(&mut msg, send_id);
        assert_eq!(
            msg.data.unwrap().as_str().unwrap(),
            "plain-string-payload",
            "non-object data must pass through unchanged"
        );
    }

    #[test]
    fn inject_msg_id_overwrites_existing_sentori_key() {
        let mut msg = empty_msg();
        msg.data = Some(json!({ "_sentori": { "msgId": "old-id" }, "user": "u123" }));
        let send_id = Uuid::now_v7();
        inject_sentori_msg_id(&mut msg, send_id);
        let data = msg.data.unwrap();
        let sentori = data.get("_sentori").and_then(|v| v.as_object()).unwrap();
        let want = crate::push::types::format_send_id(send_id);
        assert_eq!(sentori.get("msgId").unwrap().as_str().unwrap(), want);
        assert_eq!(data.get("user").unwrap().as_str().unwrap(), "u123");
    }
}
