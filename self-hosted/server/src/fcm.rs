//! FCM (Firebase Cloud Messaging) vendor adapter — Legacy HTTP API.
//!
//! Uses the deprecated-but-still-working server key auth path:
//!   POST https://fcm.googleapis.com/fcm/send
//!   Authorization: key=<server_key>
//!   Content-Type: application/json
//!
//! FCM HTTP v1 (OAuth2 via service-account) is K7.2 follow-up.
//! Legacy works for the common SaaS deployment shape and lets
//! self-hosted users wire up Android push without OAuth churn.

use serde::Serialize;
use std::time::Duration;

pub struct FcmConfig {
    /// Legacy server key (AAAA...:APA9...).
    pub server_key: String,
}

#[derive(Debug, thiserror::Error)]
pub enum FcmError {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("fcm rejected: status={status} body={body}")]
    Rejected { status: u16, body: String },
}

#[derive(Serialize)]
struct FcmBody<'a> {
    to: &'a str,
    notification: Notification<'a>,
}

#[derive(Serialize)]
struct Notification<'a> {
    title: &'a str,
    body: &'a str,
}

pub async fn send(
    cfg: &FcmConfig,
    device_token: &str,
    title: &str,
    body_text: &str,
) -> Result<u16, FcmError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;
    let resp = client
        .post("https://fcm.googleapis.com/fcm/send")
        .header("authorization", format!("key={}", cfg.server_key))
        .json(&FcmBody {
            to: device_token,
            notification: Notification {
                title,
                body: body_text,
            },
        })
        .send()
        .await?;
    let status = resp.status().as_u16();
    if (200..400).contains(&status) {
        return Ok(status);
    }
    let body = resp.text().await.unwrap_or_default();
    Err(FcmError::Rejected { status, body })
}
