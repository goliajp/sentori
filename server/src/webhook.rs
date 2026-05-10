// Phase 27 sub-D: outbound webhook delivery.
//
// One signed POST per call. Body is opaque JSON; the caller (today
// only the alert notifier path) hands us the bytes already serialised.
// Signing follows the convention locked in `protocol.md` for the
// audit-event webhook so receivers can use the same verification
// helper for alert deliveries:
//
//   sentori-signature: t=<unix-seconds>,v1=<hex hmac-sha256>
//   covers: f"{timestamp}.{raw_body}"
//
// v0.2 retry policy is **best-effort once + log**. The persistent
// retry queue (`at_*` schedule from the audit-webhook spec) lands in
// a follow-up sub when the alert-spam pressure justifies it; the
// audit log already captures rule-fire history so we don't lose
// "did the rule fire" even when delivery itself drops.

use std::time::Duration;

use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_TIMEOUT: Duration = Duration::from_secs(10);
const SDK_UA: &str = "sentori/0.2";

#[derive(Debug)]
pub struct WebhookDelivery {
    pub event: &'static str, // value of `sentori-event` header
    pub url: String,
    pub secret: String,
    pub body: Vec<u8>,
}

/// HMAC-SHA-256 helper exposed for tests + future audit-webhook code
/// path. Returns hex string of length 64.
pub fn sign(secret: &str, timestamp: i64, body: &[u8]) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes())
        .expect("hmac key");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    hex_encode(&mac.finalize().into_bytes())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

pub async fn send(d: &WebhookDelivery) -> Result<reqwest::StatusCode, anyhow::Error> {
    let timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let signature = sign(&d.secret, timestamp, &d.body);
    let delivery_id = Uuid::now_v7();
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(READ_TIMEOUT)
        .build()?;
    let resp = client
        .post(&d.url)
        .header("content-type", "application/json")
        .header("sentori-event", d.event)
        .header("sentori-delivery-id", delivery_id.to_string())
        .header("sentori-timestamp", timestamp.to_string())
        .header("sentori-signature", format!("t={timestamp},v1={signature}"))
        .header("user-agent", SDK_UA)
        .body(d.body.clone())
        .send()
        .await?;
    Ok(resp.status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_is_deterministic_and_format_locked() {
        let s = sign("topsecret", 1_700_000_000, b"hello");
        // Length is 64 hex chars (256 bits).
        assert_eq!(s.len(), 64);
        // Same inputs produce same output.
        assert_eq!(sign("topsecret", 1_700_000_000, b"hello"), s);
        // Different secret → different output.
        assert_ne!(sign("other", 1_700_000_000, b"hello"), s);
        // Different body → different output.
        assert_ne!(sign("topsecret", 1_700_000_000, b"hellp"), s);
        // Different timestamp → different output (replay protection).
        assert_ne!(sign("topsecret", 1_700_000_001, b"hello"), s);
    }
}
