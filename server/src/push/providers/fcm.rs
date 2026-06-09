// v2.7 W5 — Firebase Cloud Messaging v1 provider.
//
// Auth (2-step):
//   1. Sign an RS256 JWT with the service-account `private_key`,
//      claims `{ iss: client_email, scope, aud: token_uri, iat, exp }`,
//      exp = iat + 3600.
//   2. POST `grant_type=...&assertion=<jwt>` to `token_uri` (typically
//      https://oauth2.googleapis.com/token); Google returns
//      `{ access_token, expires_in }`. Cache for `expires_in - 60s`
//      keyed by service-account client_email.
//
// Transport: POST to
//   https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
// with `Authorization: Bearer <access_token>`.
//
// Body: FCM v1 message envelope (`{ "message": { ... } }`).
//
// Outcome classification (per FCM docs):
//   200                                  → Sent
//   404 + UNREGISTERED                   → PermanentlyInvalidToken
//   400 + INVALID_ARGUMENT               → TerminalOther
//   400 + INVALID_REGISTRATION           → PermanentlyInvalidToken
//   401 + UNAUTHENTICATED                → TerminalOther (cred revoked)
//   403 + SENDER_ID_MISMATCH             → PermanentlyInvalidToken
//   429 + QUOTA_EXCEEDED                 → Transient(retry_after)
//   5xx                                  → Transient(None)
//   other                                → TerminalOther

use async_trait::async_trait;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

use super::{
    Credential, Provider, ProviderError, ProviderKind, ProviderResult, SendOutcome,
    ValidateOutcome,
};
use crate::push::token_cache::TokenCache;
use crate::push::types::{NativeMessage, Priority};

const FCM_SEND_URL: &str = "https://fcm.googleapis.com/v1/projects";
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

/// FCM v1 OAuth tokens carry `expires_in` (~3600 s). v2.20 caches via
/// the unified [`TokenCache`] keyed by service-account `client_email`.
/// Cache TTL = `expires_in` minus this safety margin, so we never hand
/// out a token already inside its dying window.
const FCM_OAUTH_TTL_MARGIN: Duration = Duration::from_secs(60);

pub struct FcmProvider {
    http_client: reqwest::Client,
    /// Process-wide access-token cache keyed by `client_email`. v2.20
    /// switched from a hand-rolled `Arc<Mutex<HashMap>>` to the unified
    /// `TokenCache` — single code path for all four JWT/OAuth signers
    /// in the push pipeline, single seam for tests.
    token_cache: TokenCache<String, String>,
}

impl FcmProvider {
    /// v2.21 — FCM gets its own `reqwest::Client`. HTTP/2 OAuth +
    /// per-project `messages:send` connections to
    /// `fcm.googleapis.com`. Standard 60 s idle.
    pub fn new() -> Self {
        let http_client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .pool_idle_timeout(Some(Duration::from_secs(60)))
            .pool_max_idle_per_host(4)
            .build()
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "fcm client build failed; using default");
                reqwest::Client::new()
            });
        Self {
            http_client,
            token_cache: TokenCache::new(),
        }
    }

    async fn access_token(&self, secret: &FcmSecret) -> Result<String, ProviderError> {
        let http_client = self.http_client.clone();
        let token_uri = secret.token_uri.clone();
        let client_email = secret.client_email.clone();
        let secret_clone = secret.clone();

        self.token_cache
            .get_or_insert_with(client_email, move || async move {
                let jwt = sign_oauth_jwt(&secret_clone).map_err(|e| {
                    ProviderError::CredentialMalformed(format!("oauth jwt sign: {e}"))
                })?;
                let resp = http_client
                    .post(&token_uri)
                    .form(&[
                        ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                        ("assertion", jwt.as_str()),
                    ])
                    .send()
                    .await
                    .map_err(|e| ProviderError::HttpTransport(format!("oauth: {e}")))?;
                if !resp.status().is_success() {
                    let status = resp.status().as_u16();
                    let body = resp.text().await.unwrap_or_default();
                    return Err(ProviderError::CredentialMalformed(format!(
                        "oauth {status}: {}",
                        truncate_2k(&body)
                    )));
                }
                let tok: TokenResponse = resp
                    .json()
                    .await
                    .map_err(|e| ProviderError::HttpTransport(format!("oauth body: {e}")))?;
                let ttl = Duration::from_secs(tok.expires_in.unwrap_or(3600))
                    .saturating_sub(FCM_OAUTH_TTL_MARGIN);
                Ok((tok.access_token, Instant::now() + ttl))
            })
            .await
    }
}

#[derive(Clone, Deserialize)]
struct FcmConfig {
    project_id: String,
}

#[derive(Clone, Deserialize)]
struct FcmSecret {
    client_email: String,
    private_key: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

fn default_token_uri() -> String {
    "https://oauth2.googleapis.com/token".into()
}

#[derive(Serialize)]
struct OauthClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
}

#[async_trait]
impl Provider for FcmProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Fcm
    }

    async fn send(
        &self,
        cred: Credential<'_>,
        native_token: &str,
        _env: Option<&str>,
        msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError> {
        let config: FcmConfig = serde_json::from_value(cred.config.clone())
            .map_err(|e| ProviderError::CredentialMalformed(format!("config: {e}")))?;
        let secret: FcmSecret = serde_json::from_slice(cred.secret_payload)
            .map_err(|e| ProviderError::CredentialMalformed(format!("secret: {e}")))?;
        let access_token = self.access_token(&secret).await?;

        let body = build_fcm_message(native_token, msg);
        let url = format!("{FCM_SEND_URL}/{}/messages:send", config.project_id);
        let t0 = Instant::now();
        let resp = self
            .http_client
            .post(&url)
            .bearer_auth(&access_token)
            .json(&body)
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

        let truncated = truncate_2k(&raw_body);
        let fcm_err = extract_fcm_error(&raw_body);
        let (outcome, label) = classify(status.as_u16(), fcm_err.as_deref(), retry_after);
        Ok(ProviderResult {
            outcome,
            provider_outcome_label: label,
            provider_status: Some(status.as_u16() as i32),
            provider_body: Some(truncated),
            duration_ms,
        })
    }

    async fn validate(&self, cred: Credential<'_>) -> ValidateOutcome {
        // FCM exposes a cheap auth challenge: mint an OAuth access
        // token via the JWT-bearer grant. If Google says 200 the
        // service-account JSON is well-formed AND active. We reuse
        // `access_token` so a successful validate populates the
        // cache for the next actual send.
        let _: FcmConfig = match serde_json::from_value(cred.config.clone()) {
            Ok(c) => c,
            Err(e) => return ValidateOutcome::Malformed { reason: format!("config: {e}") },
        };
        let secret: FcmSecret = match serde_json::from_slice(cred.secret_payload) {
            Ok(s) => s,
            Err(e) => return ValidateOutcome::Malformed { reason: format!("secret: {e}") },
        };
        match self.access_token(&secret).await {
            Ok(_) => ValidateOutcome::Ok,
            Err(ProviderError::CredentialMalformed(reason)) => {
                // `access_token` returns CredentialMalformed for both
                // PEM parse failures (offline) and OAuth 4xx (Google
                // rejected the JWT). For UX, treat the offline case
                // as Malformed and the network reject as Rejected.
                if reason.starts_with("oauth jwt sign:") {
                    ValidateOutcome::Malformed { reason }
                } else {
                    ValidateOutcome::Rejected { reason }
                }
            }
            Err(ProviderError::HttpTransport(reason)) => {
                ValidateOutcome::Unreachable { reason }
            }
            Err(other) => ValidateOutcome::Rejected { reason: format!("{other}") },
        }
    }
}

fn sign_oauth_jwt(secret: &FcmSecret) -> Result<String, String> {
    let iat = now_secs();
    let claims = OauthClaims {
        iss: secret.client_email.as_str(),
        scope: FCM_SCOPE,
        aud: secret.token_uri.as_str(),
        iat,
        exp: iat + 3600,
    };
    let header = Header::new(Algorithm::RS256);
    let key = EncodingKey::from_rsa_pem(secret.private_key.as_bytes())
        .map_err(|e| format!("parse private_key: {e}"))?;
    encode(&header, &claims, &key).map_err(|e| format!("encode: {e}"))
}

fn build_fcm_message(native_token: &str, msg: &NativeMessage) -> Value {
    let mut message = serde_json::Map::new();
    message.insert("token".into(), Value::String(native_token.into()));
    // v2.28 — rich-media image lives on the FCM `notification` envelope;
    // FCM auto-renders Android BigPicture from it. We have to ensure the
    // `notification` object exists even when title/body are absent.
    let rich_image = msg
        .options
        .rich_media
        .as_ref()
        .and_then(|r| r.image_url.as_deref());
    if msg.title.is_some() || msg.body.is_some() || rich_image.is_some() {
        let mut notif = serde_json::Map::new();
        if let Some(t) = msg.title.as_ref() {
            notif.insert("title".into(), Value::String(t.clone()));
        }
        if let Some(b) = msg.body.as_ref() {
            notif.insert("body".into(), Value::String(b.clone()));
        }
        if let Some(url) = rich_image {
            notif.insert("image".into(), Value::String(url.to_string()));
        }
        message.insert("notification".into(), Value::Object(notif));
    }
    // FCM requires data values to be strings.
    // v2.29 — inject `sentori_actions` (JSON-stringified) into data so
    // the Android host can read interactive actions out of the FCM
    // RemoteMessage payload.
    let mut stringified = serde_json::Map::new();
    if let Some(Value::Object(data)) = msg.data.as_ref() {
        for (k, v) in data.iter() {
            let s = match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            stringified.insert(k.clone(), Value::String(s));
        }
    }
    if let Some(actions) = msg.options.actions.as_ref() {
        if let Ok(json_str) = serde_json::to_string(actions) {
            stringified.insert("sentori_actions".into(), Value::String(json_str));
        }
    }
    if !stringified.is_empty() {
        message.insert("data".into(), Value::Object(stringified));
    }
    let mut android = serde_json::Map::new();
    if matches!(msg.options.priority, Some(Priority::High)) {
        android.insert("priority".into(), Value::String("high".into()));
    }
    if let Some(c) = msg.options.collapse_key.as_ref() {
        android.insert("collapse_key".into(), Value::String(c.clone()));
    }
    if let Some(ttl) = msg.options.ttl {
        android.insert(
            "ttl".into(),
            Value::String(format!("{}s", ttl.max(0))),
        );
    }
    // v2.30 — `channel_importance` maps to FCM's
    // `notification_priority` enum on the Android notification
    // envelope. Combine with the existing `channel_id` write below.
    let importance = msg
        .options
        .channel_importance
        .as_deref()
        .map(|i| match i {
            "high" => "PRIORITY_HIGH",
            "low" => "PRIORITY_LOW",
            "min" => "PRIORITY_MIN",
            _ => "PRIORITY_DEFAULT",
        });
    if msg.options.channel_id.is_some() || importance.is_some() {
        let mut notif_android = serde_json::Map::new();
        if let Some(chan) = msg.options.channel_id.as_ref() {
            notif_android.insert("channel_id".into(), Value::String(chan.clone()));
        }
        if let Some(prio) = importance {
            notif_android.insert(
                "notification_priority".into(),
                Value::String(prio.to_string()),
            );
        }
        android.insert("notification".into(), Value::Object(notif_android));
    }
    if !android.is_empty() {
        message.insert("android".into(), Value::Object(android));
    }
    json!({ "message": Value::Object(message) })
}

fn extract_fcm_error(body: &str) -> Option<String> {
    // FCM error body: { "error": { "status": "UNAVAILABLE",
    // "details": [{ "errorCode": "UNREGISTERED" }] } }
    let v: Value = serde_json::from_str(body).ok()?;
    if let Some(details) = v
        .get("error")
        .and_then(|e| e.get("details"))
        .and_then(|d| d.as_array())
    {
        for entry in details {
            if let Some(code) = entry.get("errorCode").and_then(|c| c.as_str()) {
                return Some(code.to_string());
            }
        }
    }
    v.get("error")
        .and_then(|e| e.get("status"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
}

fn classify(
    status: u16,
    err_code: Option<&str>,
    retry_after: Option<i32>,
) -> (SendOutcome, String) {
    match status {
        200 => (SendOutcome::Sent, "FCM_200".into()),
        400 => match err_code {
            Some("INVALID_REGISTRATION") | Some("INVALID_REGISTRATION_TOKEN") => (
                SendOutcome::PermanentlyInvalidToken,
                "FCM_400_InvalidRegistration".into(),
            ),
            Some(code) => (
                SendOutcome::TerminalOther {
                    reason: format!("FCM_400: {code}"),
                },
                format!("FCM_400_{code}"),
            ),
            None => (
                SendOutcome::TerminalOther {
                    reason: "FCM_400: (no error code)".into(),
                },
                "FCM_400_Unknown".into(),
            ),
        },
        401 => (
            SendOutcome::TerminalOther {
                reason: "FCM_401_Unauthenticated".into(),
            },
            "FCM_401".into(),
        ),
        403 => match err_code {
            Some("SENDER_ID_MISMATCH") => (
                SendOutcome::PermanentlyInvalidToken,
                "FCM_403_SenderIdMismatch".into(),
            ),
            other => (
                SendOutcome::TerminalOther {
                    reason: format!("FCM_403: {}", other.unwrap_or("(no error code)")),
                },
                format!("FCM_403_{}", other.unwrap_or("Unknown")),
            ),
        },
        404 => (
            SendOutcome::PermanentlyInvalidToken,
            "FCM_404_Unregistered".into(),
        ),
        429 => (
            SendOutcome::Transient {
                retry_after_secs: retry_after,
            },
            "FCM_429_QuotaExceeded".into(),
        ),
        s if (500..=599).contains(&s) => (
            SendOutcome::Transient {
                retry_after_secs: retry_after,
            },
            format!("FCM_{s}"),
        ),
        s => (
            SendOutcome::TerminalOther {
                reason: format!("FCM_{s}: {}", err_code.unwrap_or("(no error code)")),
            },
            format!("FCM_{s}"),
        ),
    }
}

fn truncate_2k(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if out.len() + c.len_utf8() > 2048 {
            break;
        }
        out.push(c);
    }
    out
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_200_sent() {
        let (o, l) = classify(200, None, None);
        assert_eq!(o, SendOutcome::Sent);
        assert_eq!(l, "FCM_200");
    }

    #[test]
    fn classify_404_unregistered() {
        let (o, _) = classify(404, Some("UNREGISTERED"), None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
    }

    #[test]
    fn classify_400_invalid_registration() {
        let (o, _) = classify(400, Some("INVALID_REGISTRATION"), None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
    }

    #[test]
    fn classify_403_sender_id_mismatch() {
        let (o, _) = classify(403, Some("SENDER_ID_MISMATCH"), None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
    }

    #[test]
    fn classify_429_transient() {
        let (o, _) = classify(429, Some("QUOTA_EXCEEDED"), Some(60));
        assert_eq!(
            o,
            SendOutcome::Transient {
                retry_after_secs: Some(60),
            }
        );
    }

    #[test]
    fn classify_503_transient() {
        let (o, _) = classify(503, None, None);
        assert!(matches!(
            o,
            SendOutcome::Transient {
                retry_after_secs: None
            }
        ));
    }

    #[test]
    fn build_message_includes_notif_and_data_strings() {
        let msg = NativeMessage {
            to: crate::push::types::ToField::Single("ipt_x".into()),
            title: Some("Hi".into()),
            body: Some("Hello".into()),
            data: Some(json!({ "issueId": "iss_1", "count": 3 })),
            options: crate::push::types::NativeOptions {
                priority: Some(Priority::High),
                ttl: Some(60),
                collapse_key: Some("col".into()),
                channel_id: Some("messages".into()),
                ..Default::default()
            },
            idempotency_key: None,
            send_at: None,
            campaign_id: None,
            template_id: None,
            audience_tag: None,
        };
        let v = build_fcm_message("ABCDEF", &msg);
        let m = v.get("message").unwrap();
        assert_eq!(m["token"], "ABCDEF");
        assert_eq!(m["notification"]["title"], "Hi");
        assert_eq!(m["data"]["issueId"], "iss_1");
        // FCM requires data values to be strings — number was stringified.
        assert_eq!(m["data"]["count"], "3");
        assert_eq!(m["android"]["priority"], "high");
        assert_eq!(m["android"]["collapse_key"], "col");
        assert_eq!(m["android"]["ttl"], "60s");
        assert_eq!(m["android"]["notification"]["channel_id"], "messages");
    }

    #[test]
    fn extract_fcm_error_handles_details() {
        let body = r#"{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}"#;
        assert_eq!(extract_fcm_error(body).as_deref(), Some("UNREGISTERED"));
    }

    #[test]
    fn build_fcm_message_includes_notification_image_when_rich_media_set() {
        // v2.28 — rich-media image URL must land at notification.image
        // for FCM to auto-render Android BigPicture.
        let msg = crate::push::types::NativeMessage {
            to: crate::push::types::ToField::Single("ipt_x".into()),
            title: Some("Hello".into()),
            body: Some("World".into()),
            data: None,
            options: crate::push::types::NativeOptions {
                rich_media: Some(crate::push::types::RichMedia {
                    image_url: Some("https://cdn.example/big.jpg".into()),
                }),
                ..Default::default()
            },
            idempotency_key: None,
            send_at: None,
            campaign_id: None,
            template_id: None,
            audience_tag: None,
        };
        let v = build_fcm_message("tok_abc", &msg);
        let notif = v
            .get("message")
            .and_then(|m| m.get("notification"))
            .and_then(|x| x.as_object())
            .unwrap();
        assert_eq!(
            notif.get("image").and_then(|x| x.as_str()),
            Some("https://cdn.example/big.jpg")
        );
        assert_eq!(notif.get("title").and_then(|x| x.as_str()), Some("Hello"));
    }

    #[test]
    fn build_fcm_message_omits_image_when_rich_media_absent() {
        let msg = crate::push::types::NativeMessage {
            to: crate::push::types::ToField::Single("ipt_x".into()),
            title: Some("plain".into()),
            body: Some("plain body".into()),
            data: None,
            options: crate::push::types::NativeOptions::default(),
            idempotency_key: None,
            send_at: None,
            campaign_id: None,
            template_id: None,
            audience_tag: None,
        };
        let v = build_fcm_message("tok_abc", &msg);
        let notif = v
            .get("message")
            .and_then(|m| m.get("notification"))
            .and_then(|x| x.as_object())
            .unwrap();
        assert!(notif.get("image").is_none());
    }

    #[test]
    fn extract_fcm_error_falls_back_to_status() {
        let body = r#"{"error":{"status":"UNAVAILABLE"}}"#;
        assert_eq!(extract_fcm_error(body).as_deref(), Some("UNAVAILABLE"));
    }

    // Throwaway RSA-2048 PKCS#8 PEM — not tied to any real Google
    // service account. Generated solely for crypto smoke tests; safe
    // to commit. v2.20 P4.
    const TEST_RSA_PEM: &str = "-----BEGIN PRIVATE KEY-----\n\
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5QQxYXJcPKHmJ\n\
hj36luX0WWBn6LJCkPRsZPbSV9e2PSJOS1QpieHZiy4rEWgRsxlmic1OFzqZIUNc\n\
Dy42qN5BiVvc4q7CRwrxMOZyH6khvQVNINnbwDyae2/OG+2M4EkeTxje4woZjIJg\n\
wJ0ddZY4FiEesA7qD87vRl+Dn25ygzuS2m8yFRlnOTjdowGNww3aV+O0i2JNwjbJ\n\
LDjp4KkDdYTHnmqLsp6iFrcE6z0w+TB0zMFd4VGHURN+PTbkJFfySm5g9M6M2zv3\n\
OfioR020dJ1v6C35VJbDgENdxc0Gfi+SbHtnl7t2sgNSOYE2K0ddrp6sewmMrZLe\n\
coFHRhXzAgMBAAECggEADG/vDb5tnKScs3YLrDEitoRxNTJJexZmd1TrjNSj7h+H\n\
MZcO5L9vWV6yo0z595I87TlPZMpCpcXQOWdPGxFV42cYf6kvKJ21zadff7lbbm3u\n\
/XrsO9VZddk930PY73SeKnnbk0wBdHsOXintHAcccwVQhOudNlHVLhN2u/LH6sno\n\
1BUT7WYbhw8gctrXwwMGAM607gLW0PZ/3MAvvbxbRmb30S67B3NATOidkgu+BT2H\n\
7o/iwlA4kelq2TIk1fHO/fqIqtm85yd98zNMYE10buZSbwn9DxrvoRDoMTVFkwTq\n\
G1kDmGgMoGU2S0b2Ned8o8luQ4y5eS8F7L6O9/I5UQKBgQDnNzdJyJqDhUIZip5H\n\
QbjgjwirBybn01JX98WZ8UwO2jkSuMviYXIggfWcG5sHZD/jOnfqvwWlTM6QR3ql\n\
ZA4NUf5Wh/2dyL7Dp7V9ZKLI/ehDgaSWNoYkxxTlUmk9afqLji+E6tvHoJjbnYyO\n\
/iK4LpmXQdEbsvMwhpoPDYaAcQKBgQDNHJnvaGUFcem+4AsTFNGpq6SIfe2yKkzp\n\
mKzfLMDhAdxvuMjBpq78PuDQYA1/075ZBx4ZMxYtSF0sRSM1bpg60wmI53Jyx/aW\n\
MCdrPxFRnQyXPxLEAPg2gtZ6qHDQyGiCJP/2DLeoGkByYO3oigf1HFTY3BG4fYIL\n\
gDm+v24uowKBgQDF1k0MaQUsu/0O9bjwp5+VJU35aSk0+3BdrLf7PKgjnT1wc4ag\n\
sViB0DFj3YsNDA5OU10AE2q1Qb8NXNvoYHBVnW7Og5XSSE5SA1IbdNyEthzihi9a\n\
CFVHasDKZ3V9Aw1KE+M9C+f6K8QfRfNa9sCmb9kjv0E5PikvwDxZ3OzVQQKBgQCv\n\
2iGwPJTAAlYhK/zSszq+eUZrL2wnIFUowZkVDk2fm/TeZFLalInaAh7FCFUKjwPX\n\
WF7ZxA7za+NWHUB+gv9JD75Q/f4FoqMrSMXDESNMEZXF5nG0UhB8y9gO+XMfzXKs\n\
ggRhc63SFg/DAI94mz8PSucDtkoLHq/sJFddzsoseQKBgFw93FXHyq7nFCi1nc+G\n\
Ze8/jlPhmA/aZLOR89wjwAqwt19EG1/w3Ha2nNVHElyegLZle2GdeokqyempJbx9\n\
dob0cPBqAzsNqJ5eSHZiRfLEJP0uPuhALReKxoDGdN3G1UX9Kqk8t3p0S90ik8NJ\n\
nnsd9Cq7/706c9AhK0nu6unI\n\
-----END PRIVATE KEY-----\n";

    /// v2.20 P4 — FCM v1 OAuth assertion RS256 sign smoke test. The
    /// only RSA path in the push pipeline; same v1.1.2-class
    /// rationale as the APNs/VAPID ES256 smokes — exercise the
    /// crypto path so a future crypto-crate breakage fails here, not
    /// in dispatch_cron.
    #[test]
    fn sign_oauth_jwt_rs256_smoke() {
        use base64::Engine as _;
        let secret = FcmSecret {
            client_email: "test@example.iam.gserviceaccount.com".into(),
            private_key: TEST_RSA_PEM.into(),
            token_uri: "https://oauth2.googleapis.com/token".into(),
        };
        let jwt = sign_oauth_jwt(&secret)
            .expect("sign_oauth_jwt must not error on a valid RSA-2048 key");
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3, "JWT must have header.payload.sig");

        let header_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[0])
            .expect("header b64");
        let header: serde_json::Value =
            serde_json::from_slice(&header_bytes).expect("header json");
        assert_eq!(header["alg"], "RS256");

        let claims_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .expect("claims b64");
        let claims: serde_json::Value =
            serde_json::from_slice(&claims_bytes).expect("claims json");
        assert_eq!(claims["iss"], "test@example.iam.gserviceaccount.com");
        assert_eq!(claims["scope"], FCM_SCOPE);
        assert_eq!(claims["aud"], "https://oauth2.googleapis.com/token");
        assert!(claims["exp"].as_u64().unwrap_or(0) > claims["iat"].as_u64().unwrap_or(0));
    }
}
