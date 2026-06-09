// v2.7 W4 — Apple Push Notification service provider.
//
// Auth: ES256 JWT signed with the project's APNs p8 private key.
// Apple's docs say the JWT can be reused within a 20-60 min window
// AND that re-signing too often trips `TooManyProviderTokenUpdates`
// (HTTP 22001) — exactly the symptom that bit v2.7's first real
// customer (see post-ship memory project-v27-push-postship-hotfixes).
// v2.20 routes every sign through `push::token_cache::TokenCache`
// keyed by `(team_id, key_id)`, TTL 20 min. Cache hit ⇒ skip the
// ~50 µs EC scalar mul; cache miss ⇒ sign and store. Credential
// rotation should call `invalidate` on the cache (no rotate UI yet).
//
// Transport: HTTP/2 POST to api.push.apple.com (production) or
// api.sandbox.push.apple.com (sandbox). reqwest's rustls stack
// negotiates h2 via ALPN out of the box.
//
// Body: APS payload JSON. NativeOptions translate into:
//   * aps.alert.title / aps.alert.body
//   * aps.sound, aps.badge
//   * aps.mutable-content, aps.content-available
//   * aps.category
// NativeMessage.data fields are flattened into the top level
// (Apple's convention — any non-`aps` keys are custom data).
//
// Outcome classification (per Apple's docs):
//   200                                  → Sent
//   400 + 'BadDeviceToken'               → PermanentlyInvalidToken
//   400 + 'BadEnvironmentKeyInToken'     → EnvironmentMismatch
//   400 + 'DeviceTokenNotForTopic'       → EnvironmentMismatch
//   410                                  → PermanentlyInvalidToken
//   413                                  → TerminalOther("MessageTooBig")
//   429                                  → Transient(retry_after from header)
//   5xx                                  → Transient(None)
//   other                                → TerminalOther("APNS_<status>: <reason>")

use async_trait::async_trait;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult, SendOutcome, ValidateOutcome};
use crate::push::token_cache::TokenCache;
use crate::push::types::{NativeMessage, Priority};

const HOST_PROD: &str = "https://api.push.apple.com";
const HOST_SANDBOX: &str = "https://api.sandbox.push.apple.com";

/// APNs JWT validity per Apple: 20-60 min. 20 leaves a safety margin
/// against clock skew + in-flight requests still using the old JWT
/// when we'd otherwise mint a new one.
const APNS_JWT_TTL: Duration = Duration::from_secs(20 * 60);

pub struct ApnsProvider {
    http_client: reqwest::Client,
    jwt_cache: TokenCache<(String, String), String>,
}

impl ApnsProvider {
    pub fn new(http_client: reqwest::Client) -> Self {
        Self {
            http_client,
            jwt_cache: TokenCache::new(),
        }
    }

    /// Returns a valid APNs provider JWT for `(team_id, key_id)`,
    /// signing one only if the cached entry is missing or expired.
    /// This is the v2.20 anti-blacklist hot path.
    async fn jwt_for(
        &self,
        team_id: &str,
        key_id: &str,
        p8_pem: &str,
    ) -> Result<String, String> {
        let key = (team_id.to_string(), key_id.to_string());
        self.jwt_cache
            .get_or_insert_with(key, || async {
                let jwt = sign_jwt(p8_pem, team_id, key_id)?;
                Ok::<_, String>((jwt, Instant::now() + APNS_JWT_TTL))
            })
            .await
    }
}

#[derive(Deserialize)]
struct ApnsConfig {
    key_id: String,
    team_id: String,
    bundle_id: String,
    #[serde(default = "default_env")]
    env_default: String,
}

fn default_env() -> String {
    "production".into()
}

#[derive(Deserialize)]
struct ApnsSecret {
    p8: String,
}

#[derive(Serialize)]
struct JwtClaims<'a> {
    iss: &'a str,
    iat: u64,
}

#[async_trait]
impl Provider for ApnsProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Apns
    }

    async fn send(
        &self,
        cred: Credential<'_>,
        native_token: &str,
        env: Option<&str>,
        msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError> {
        let config: ApnsConfig = serde_json::from_value(cred.config.clone())
            .map_err(|e| ProviderError::CredentialMalformed(format!("config: {e}")))?;
        let secret: ApnsSecret = serde_json::from_slice(cred.secret_payload)
            .map_err(|e| ProviderError::CredentialMalformed(format!("secret: {e}")))?;

        // Effective env: per-token (if registered as sandbox/prod)
        // wins, else config default.
        let host = match env.unwrap_or(config.env_default.as_str()) {
            "sandbox" => HOST_SANDBOX,
            _ => HOST_PROD,
        };

        let jwt = self
            .jwt_for(&config.team_id, &config.key_id, &secret.p8)
            .await
            .map_err(|e| ProviderError::CredentialMalformed(format!("jwt sign: {e}")))?;

        let body = build_aps_payload(msg);
        let body_bytes = serde_json::to_vec(&body)
            .map_err(|e| ProviderError::PayloadMalformed(format!("body serialize: {e}")))?;

        let url = format!("{host}/3/device/{native_token}");
        let mut req = self
            .http_client
            .post(&url)
            .header("authorization", format!("bearer {jwt}"))
            .header("apns-topic", &config.bundle_id)
            .header("apns-push-type", aps_push_type(msg))
            .header("apns-priority", aps_priority(msg).to_string())
            .body(body_bytes);
        if let Some(ttl) = msg.options.ttl {
            let exp = now_secs().saturating_add(ttl.max(0) as u64);
            req = req.header("apns-expiration", exp.to_string());
        }
        if let Some(collapse) = msg.options.collapse_key.as_deref() {
            // APNs caps apns-collapse-id at 64 bytes.
            let trimmed: String = collapse.chars().take(64).collect();
            req = req.header("apns-collapse-id", trimmed);
        }
        let t0 = Instant::now();
        let resp = req
            .send()
            .await
            .map_err(|e| ProviderError::HttpTransport(format!("{e}")))?;
        let status = resp.status();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<i32>().ok());
        let raw_body = resp
            .text()
            .await
            .map_err(|e| ProviderError::HttpTransport(format!("body read: {e}")))?;
        let duration_ms = t0.elapsed().as_millis().min(i32::MAX as u128) as i32;

        let truncated_body = truncate_2k(&raw_body);
        let reason = extract_reason(&raw_body);

        let (outcome, label) = classify(status.as_u16(), reason.as_deref(), retry_after);
        Ok(ProviderResult {
            outcome,
            provider_outcome_label: label,
            provider_status: Some(status.as_u16() as i32),
            provider_body: Some(truncated_body),
            duration_ms,
        })
    }

    async fn validate(&self, cred: Credential<'_>) -> ValidateOutcome {
        // APNs has no cheap auth challenge — its `/3/device/<token>`
        // POST is the only entry, and we have no device token to
        // address. So validate by parsing the p8 PEM and signing a
        // throwaway JWT; if that works the cred is structurally fine.
        let config: ApnsConfig = match serde_json::from_value(cred.config.clone()) {
            Ok(c) => c,
            Err(e) => return ValidateOutcome::Malformed { reason: format!("config: {e}") },
        };
        let secret: ApnsSecret = match serde_json::from_slice(cred.secret_payload) {
            Ok(s) => s,
            Err(e) => return ValidateOutcome::Malformed { reason: format!("secret: {e}") },
        };
        match self
            .jwt_for(&config.team_id, &config.key_id, &secret.p8)
            .await
        {
            Ok(_) => ValidateOutcome::Ok,
            Err(e) => ValidateOutcome::Malformed { reason: format!("jwt sign: {e}") },
        }
    }
}

fn sign_jwt(p8_pem: &str, team_id: &str, key_id: &str) -> Result<String, String> {
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(key_id.to_string());
    let claims = JwtClaims {
        iss: team_id,
        iat: now_secs(),
    };
    let key = EncodingKey::from_ec_pem(p8_pem.as_bytes())
        .map_err(|e| format!("parse p8: {e}"))?;
    encode(&header, &claims, &key).map_err(|e| format!("encode: {e}"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn aps_push_type(msg: &NativeMessage) -> &'static str {
    if msg.options.content_available == Some(true) && msg.title.is_none() && msg.body.is_none() {
        "background"
    } else {
        "alert"
    }
}

fn aps_priority(msg: &NativeMessage) -> u8 {
    // background pushes must be priority 5 per Apple's docs.
    if aps_push_type(msg) == "background" {
        return 5;
    }
    match msg.options.priority {
        Some(Priority::High) => 10,
        _ => 10,
    }
}

fn build_aps_payload(msg: &NativeMessage) -> Value {
    let mut aps = serde_json::Map::new();
    if msg.title.is_some() || msg.body.is_some() {
        let mut alert = serde_json::Map::new();
        if let Some(t) = msg.title.as_ref() {
            alert.insert("title".into(), Value::String(t.clone()));
        }
        if let Some(b) = msg.body.as_ref() {
            alert.insert("body".into(), Value::String(b.clone()));
        }
        aps.insert("alert".into(), Value::Object(alert));
    }
    if let Some(s) = msg.options.sound.as_ref() {
        aps.insert("sound".into(), Value::String(s.clone()));
    }
    if let Some(b) = msg.options.badge {
        aps.insert("badge".into(), json!(b));
    }
    if msg.options.mutable_content == Some(true) {
        aps.insert("mutable-content".into(), json!(1));
    }
    if msg.options.content_available == Some(true) {
        aps.insert("content-available".into(), json!(1));
    }
    if let Some(c) = msg.options.category.as_ref() {
        aps.insert("category".into(), Value::String(c.clone()));
    }
    let mut root = serde_json::Map::new();
    root.insert("aps".into(), Value::Object(aps));
    // Custom data fields land at the top level alongside `aps` per
    // Apple's convention. If a customer accidentally names a key
    // `aps` we keep ours (the canonical APNs key).
    if let Some(Value::Object(custom)) = msg.data.as_ref() {
        for (k, v) in custom.iter() {
            if k == "aps" {
                continue;
            }
            root.insert(k.clone(), v.clone());
        }
    }
    Value::Object(root)
}

fn truncate_2k(s: &str) -> String {
    // Truncate on char boundary, ≤ 2 KB.
    let mut out = String::new();
    for c in s.chars() {
        if out.len() + c.len_utf8() > 2048 {
            break;
        }
        out.push(c);
    }
    out
}

fn extract_reason(body: &str) -> Option<String> {
    // APNs error body is `{"reason": "BadDeviceToken", ...}`. Parse
    // permissively — when the body isn't JSON we just don't get a
    // reason.
    let v: Value = serde_json::from_str(body).ok()?;
    v.get("reason")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string())
}

fn classify(
    status: u16,
    reason: Option<&str>,
    retry_after: Option<i32>,
) -> (SendOutcome, String) {
    match status {
        200 => (SendOutcome::Sent, "APNS_200".into()),
        400 => match reason {
            Some("BadDeviceToken") | Some("Unregistered") => (
                SendOutcome::PermanentlyInvalidToken,
                "APNS_400_BadDeviceToken".into(),
            ),
            Some("BadEnvironmentKeyInToken") | Some("DeviceTokenNotForTopic") => (
                SendOutcome::EnvironmentMismatch,
                format!("APNS_400_{}", reason.unwrap()),
            ),
            other => (
                SendOutcome::TerminalOther {
                    reason: format!("APNS_400: {}", other.unwrap_or("(no reason)")),
                },
                format!("APNS_400_{}", other.unwrap_or("Unknown")),
            ),
        },
        410 => (
            SendOutcome::PermanentlyInvalidToken,
            "APNS_410_Unregistered".into(),
        ),
        413 => (
            SendOutcome::TerminalOther {
                reason: "MessageTooBig".into(),
            },
            "APNS_413_PayloadTooLarge".into(),
        ),
        429 => (
            SendOutcome::Transient {
                retry_after_secs: retry_after,
            },
            "APNS_429_TooManyRequests".into(),
        ),
        s if (500..=599).contains(&s) => (
            SendOutcome::Transient {
                retry_after_secs: retry_after,
            },
            format!("APNS_{s}"),
        ),
        s => (
            SendOutcome::TerminalOther {
                reason: format!("APNS_{s}: {}", reason.unwrap_or("(no reason)")),
            },
            format!("APNS_{s}"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_200_sent() {
        let (o, l) = classify(200, None, None);
        assert_eq!(o, SendOutcome::Sent);
        assert_eq!(l, "APNS_200");
    }

    #[test]
    fn classify_400_bad_device_token() {
        let (o, l) = classify(400, Some("BadDeviceToken"), None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
        assert_eq!(l, "APNS_400_BadDeviceToken");
    }

    #[test]
    fn classify_400_environment_mismatch() {
        let (o, _) = classify(400, Some("BadEnvironmentKeyInToken"), None);
        assert_eq!(o, SendOutcome::EnvironmentMismatch);
        let (o2, _) = classify(400, Some("DeviceTokenNotForTopic"), None);
        assert_eq!(o2, SendOutcome::EnvironmentMismatch);
    }

    #[test]
    fn classify_410_unregistered() {
        let (o, _) = classify(410, None, None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
    }

    #[test]
    fn classify_413_message_too_big() {
        let (o, _) = classify(413, None, None);
        assert!(matches!(o, SendOutcome::TerminalOther { reason } if reason == "MessageTooBig"));
    }

    #[test]
    fn classify_429_with_retry_after() {
        let (o, _) = classify(429, None, Some(30));
        assert_eq!(
            o,
            SendOutcome::Transient {
                retry_after_secs: Some(30)
            }
        );
    }

    #[test]
    fn classify_500_transient() {
        let (o, _) = classify(503, None, None);
        assert_eq!(
            o,
            SendOutcome::Transient {
                retry_after_secs: None
            }
        );
    }

    #[test]
    fn aps_payload_includes_alert_and_custom_data() {
        let msg = NativeMessage {
            to: crate::push::types::ToField::Single("ipt_abc".into()),
            title: Some("hello".into()),
            body: Some("world".into()),
            data: Some(json!({ "issueId": "iss_123", "deepLink": "/x" })),
            options: crate::push::types::NativeOptions {
                sound: Some("default".into()),
                badge: Some(3),
                priority: Some(Priority::High),
                ttl: Some(60),
                mutable_content: Some(true),
                content_available: None,
                collapse_key: None,
                channel_id: None,
                category: Some("MSG".into()),
            },
            idempotency_key: None,
        };
        let v = build_aps_payload(&msg);
        let aps = v.get("aps").and_then(|x| x.as_object()).unwrap();
        assert_eq!(aps.get("alert").unwrap()["title"], "hello");
        assert_eq!(aps.get("alert").unwrap()["body"], "world");
        assert_eq!(aps.get("sound").unwrap(), "default");
        assert_eq!(aps.get("badge").unwrap(), 3);
        assert_eq!(aps.get("mutable-content").unwrap(), 1);
        assert_eq!(aps.get("category").unwrap(), "MSG");
        assert_eq!(v.get("issueId").unwrap(), "iss_123");
        assert_eq!(v.get("deepLink").unwrap(), "/x");
    }

    #[test]
    fn aps_background_push_when_only_content_available() {
        let msg = NativeMessage {
            to: crate::push::types::ToField::Single("ipt_x".into()),
            title: None,
            body: None,
            data: None,
            options: crate::push::types::NativeOptions {
                content_available: Some(true),
                ..Default::default()
            },
            idempotency_key: None,
        };
        assert_eq!(aps_push_type(&msg), "background");
        assert_eq!(aps_priority(&msg), 5);
    }

    #[test]
    fn truncate_2k_keeps_under_cap() {
        let big = "a".repeat(5000);
        let t = truncate_2k(&big);
        assert!(t.len() <= 2048);
        assert!(t.starts_with("aaaa"));
    }

    // Throwaway P-256 PKCS#8 PEM — public key not associated with any
    // real Apple developer account. Generated solely for crypto smoke
    // tests; safe to commit. v2.20 P4.
    const TEST_P256_PEM: &str = "-----BEGIN PRIVATE KEY-----\n\
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgwLViWNAN7cNJxHa6\n\
SazKcIgzndxVwvYbpG/4zhIrBWGhRANCAAQh8jYfkJZzsDqWF889zSvQMgn267m/\n\
BsR53w8xJYvbjbTcbzJ3Jrm5jNav9kOYS4TQS/l0cR0iLZvt+zKEZ+C2\n\
-----END PRIVATE KEY-----\n";

    /// v2.20 P4 — end-to-end crypto smoke test. The v1.1.2 incident
    /// (jsonwebtoken `rust_crypto` feature missing → all sign paths
    /// panic) shipped a green build and only fell over in prod. This
    /// test exercises the actual ES256 encode path so any future
    /// crypto crate breakage trips here, not at 2 AM in prod.
    #[test]
    fn sign_jwt_es256_smoke() {
        use base64::Engine as _;
        let jwt = sign_jwt(TEST_P256_PEM, "TEAM123456", "KEYABC9999")
            .expect("sign_jwt must not error on a valid P-256 key");
        // JWT is `header.payload.sig`.
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3, "JWT must have header.payload.sig");

        let header_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[0])
            .expect("header b64");
        let header: serde_json::Value = serde_json::from_slice(&header_bytes).expect("header json");
        assert_eq!(header["alg"], "ES256");
        assert_eq!(header["kid"], "KEYABC9999");

        let claims_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .expect("claims b64");
        let claims: serde_json::Value = serde_json::from_slice(&claims_bytes).expect("claims json");
        assert_eq!(claims["iss"], "TEAM123456");
        assert!(claims["iat"].as_u64().unwrap_or(0) > 0);
    }
}
