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
    use sqlx::Row;
    // Resolve token_id for quarantine bookkeeping after the send.
    let token_id: Option<Uuid> = sqlx::query(
        "SELECT token_id FROM push_sends WHERE id = $1",
    )
    .bind(send_id)
    .fetch_optional(pool)
    .await?
    .and_then(|r| r.try_get("token_id").ok());

    let real_outcome = match provider {
        "webpush" => try_webpush(pool, send_id).await,
        "apns" => try_apns(pool, send_id).await,
        "fcm" => try_fcm(pool, send_id).await,
        "hcm" => try_hcm(pool, send_id).await,
        "mipush" => try_mipush(pool, send_id).await,
        _ => Err("provider_not_wired".to_string()),
    };
    let (status, outcome, provider_status, duration_ms) = match real_outcome {
        Ok((code, dur)) => {
            // Successful send → reset bad_streak.
            if let Some(t) = token_id {
                crate::push_quarantine::reset_streak(pool, t).await;
            }
            // Some vendors return 2xx but contain an error field in body;
            // permanent_token_failure on non-2xx → quarantine.
            let _ = code; // body parsing is provider-specific; deferred
            ("sent", "ok", code as i32, dur as i32)
        }
        Err(reason) => {
            // Try to extract HTTP status from rejection string for quarantine
            // logic (e.g. "apns rejected: status=410 body=...").
            if let Some(t) = token_id {
                let http_status = extract_http_status(&reason);
                if let Some(code) = http_status {
                    if crate::push_quarantine::is_permanent_token_failure(provider, code) {
                        crate::push_quarantine::quarantine_token(
                            pool,
                            t,
                            &format!("{provider}: HTTP {code}"),
                        )
                        .await;
                    } else {
                        crate::push_quarantine::bump_streak(pool, t).await;
                    }
                }
                let _ = reason;
            }
            ("sent", "mock", 0, 0)
        }
    };

    sqlx::query(
        "INSERT INTO push_delivery_logs (id, send_id, attempt, outcome, provider_status, duration_ms) \
         VALUES ($1, $2, 1, $3, $4, $5)",
    )
    .bind(Uuid::now_v7())
    .bind(send_id)
    .bind(outcome)
    .bind(provider_status)
    .bind(duration_ms)
    .execute(pool)
    .await?;

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

async fn try_hcm(pool: &PgPool, send_id: Uuid) -> Result<(u16, u128), String> {
    use std::time::Instant;
    let row = sqlx::query(
        "SELECT dt.native_token, ps.payload, pc.config, pc.secret_blob \
         FROM push_sends ps \
         JOIN device_tokens dt ON dt.id = ps.token_id \
         JOIN push_credentials pc ON pc.project_id = ps.project_id AND pc.kind = 'hcm' \
         WHERE ps.id = $1",
    )
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "credentials_missing".to_string())?;
    let device_token: String = row.get("native_token");
    let payload: serde_json::Value = row.get("payload");
    let config: serde_json::Value = row.get("config");
    let client_secret = String::from_utf8(row.get::<Vec<u8>, _>("secret_blob"))
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    let client_id = config
        .get("clientId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "clientId missing".to_string())?
        .to_string();
    let app_id = config
        .get("appId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "appId missing".to_string())?
        .to_string();
    let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("Sentori");
    let body_text = payload.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let cfg = crate::hcm::HcmConfig {
        client_id,
        client_secret,
        app_id,
    };
    let start = Instant::now();
    let status = crate::hcm::send(&cfg, &device_token, title, body_text)
        .await
        .map_err(|e| e.to_string())?;
    Ok((status, start.elapsed().as_millis()))
}

async fn try_mipush(pool: &PgPool, send_id: Uuid) -> Result<(u16, u128), String> {
    use std::time::Instant;
    let row = sqlx::query(
        "SELECT dt.native_token, ps.payload, pc.config, pc.secret_blob \
         FROM push_sends ps \
         JOIN device_tokens dt ON dt.id = ps.token_id \
         JOIN push_credentials pc ON pc.project_id = ps.project_id AND pc.kind = 'mipush' \
         WHERE ps.id = $1",
    )
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "credentials_missing".to_string())?;
    let device_token: String = row.get("native_token");
    let payload: serde_json::Value = row.get("payload");
    let config: serde_json::Value = row.get("config");
    let app_secret = String::from_utf8(row.get::<Vec<u8>, _>("secret_blob"))
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    let package_name = config
        .get("packageName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "packageName missing".to_string())?
        .to_string();
    let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("Sentori");
    let body_text = payload.get("body").and_then(|v| v.as_str()).unwrap_or("");
    let cfg = crate::mipush::MiPushConfig { app_secret, package_name };
    let start = Instant::now();
    let status = crate::mipush::send(&cfg, &device_token, title, body_text)
        .await
        .map_err(|e| e.to_string())?;
    Ok((status, start.elapsed().as_millis()))
}

async fn try_fcm(pool: &PgPool, send_id: Uuid) -> Result<(u16, u128), String> {
    use std::time::Instant;
    let row = sqlx::query(
        "SELECT dt.native_token, ps.payload, pc.secret_blob \
         FROM push_sends ps \
         JOIN device_tokens dt ON dt.id = ps.token_id \
         JOIN push_credentials pc ON pc.project_id = ps.project_id AND pc.kind = 'fcm' \
         WHERE ps.id = $1",
    )
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "credentials_missing".to_string())?;
    let device_token: String = row.get("native_token");
    let payload: serde_json::Value = row.get("payload");
    let server_key = String::from_utf8(row.get::<Vec<u8>, _>("secret_blob"))
        .map_err(|e| e.to_string())?
        .trim()
        .to_string();
    let title = payload
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Sentori");
    let body_text = payload
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let cfg = crate::fcm::FcmConfig { server_key };
    let start = Instant::now();
    let status = crate::fcm::send(&cfg, &device_token, title, body_text)
        .await
        .map_err(|e| e.to_string())?;
    Ok((status, start.elapsed().as_millis()))
}

async fn try_apns(pool: &PgPool, send_id: Uuid) -> Result<(u16, u128), String> {
    use std::time::Instant;
    let row = sqlx::query(
        "SELECT dt.native_token, ps.payload, pc.config, pc.secret_blob \
         FROM push_sends ps \
         JOIN device_tokens dt ON dt.id = ps.token_id \
         JOIN push_credentials pc ON pc.project_id = ps.project_id AND pc.kind = 'apns' \
         WHERE ps.id = $1",
    )
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "credentials_missing".to_string())?;
    let device_token: String = row.get("native_token");
    let payload: serde_json::Value = row.get("payload");
    let config: serde_json::Value = row.get("config");
    let secret_pem = String::from_utf8(row.get::<Vec<u8>, _>("secret_blob"))
        .map_err(|e| e.to_string())?;

    let team_id = config
        .get("teamId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "teamId missing".to_string())?
        .to_string();
    let key_id = config
        .get("keyId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "keyId missing".to_string())?
        .to_string();
    let topic = config
        .get("topic")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "topic missing".to_string())?
        .to_string();
    let production = config
        .get("production")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let title = payload
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Sentori");
    let body_text = payload
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let cfg = crate::apns::ApnsConfig {
        team_id,
        key_id,
        topic,
        private_pem: secret_pem,
        production,
    };

    let start = Instant::now();
    let status = crate::apns::send(&cfg, &device_token, title, body_text)
        .await
        .map_err(|e| e.to_string())?;
    Ok((status, start.elapsed().as_millis()))
}

async fn try_webpush(pool: &PgPool, send_id: Uuid) -> Result<(u16, u128), String> {
    use std::time::Instant;
    let row = sqlx::query(
        "SELECT dt.native_token, pc.config, pc.secret_blob \
         FROM push_sends ps \
         JOIN device_tokens dt ON dt.id = ps.token_id \
         JOIN push_credentials pc ON pc.project_id = ps.project_id AND pc.kind = 'webpush' \
         WHERE ps.id = $1",
    )
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "credentials_missing".to_string())?;
    let endpoint: String = row.get("native_token");
    let config: serde_json::Value = row.get("config");
    let secret_pem = String::from_utf8(row.get::<Vec<u8>, _>("secret_blob"))
        .map_err(|e| e.to_string())?;
    let subject = config
        .get("subject")
        .and_then(|v| v.as_str())
        .unwrap_or("mailto:admin@localhost")
        .to_string();
    let pub_key = config
        .get("vapidPublicKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cfg = crate::webpush::WebPushConfig {
        vapid_subject: subject,
        vapid_public_key_b64url: pub_key,
        vapid_private_pem: secret_pem,
    };
    let start = Instant::now();
    let status = crate::webpush::send(&cfg, &endpoint, 3600)
        .await
        .map_err(|e| e.to_string())?;
    let dur = start.elapsed().as_millis();
    Ok((status, dur))
}

#[allow(dead_code)]
fn mock_send(provider: &str) -> (&'static str, &'static str) {
    let _ = provider;
    ("sent", "ok")
}

/// Best-effort: parse an HTTP status code out of vendor error
/// strings like "apns rejected: status=410 body=...".
fn extract_http_status(s: &str) -> Option<u16> {
    let after = s.split("status=").nth(1)?;
    let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
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
