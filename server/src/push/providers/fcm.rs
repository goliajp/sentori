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
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult, SendOutcome};
use crate::push::types::{NativeMessage, Priority};

const FCM_SEND_URL: &str = "https://fcm.googleapis.com/v1/projects";
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

pub struct FcmProvider {
    http_client: reqwest::Client,
    /// Process-wide access-token cache keyed by `client_email` (the
    /// service-account identity). Token lifetime is ~3600 s; cache
    /// expires 60 s early.
    token_cache: Arc<Mutex<std::collections::HashMap<String, CachedToken>>>,
}

impl FcmProvider {
    pub fn new(http_client: reqwest::Client) -> Self {
        Self {
            http_client,
            token_cache: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    async fn access_token(
        &self,
        secret: &FcmSecret,
    ) -> Result<String, ProviderError> {
        let now = now_secs();
        {
            let cache = self.token_cache.lock().await;
            if let Some(t) = cache.get(&secret.client_email) {
                if t.expires_at > now + 60 {
                    return Ok(t.access_token.clone());
                }
            }
        }
        // Mint a new one.
        let jwt = sign_oauth_jwt(secret).map_err(|e| {
            ProviderError::CredentialMalformed(format!("oauth jwt sign: {e}"))
        })?;
        let resp = self
            .http_client
            .post(&secret.token_uri)
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
        let cached = CachedToken {
            access_token: tok.access_token.clone(),
            expires_at: now + tok.expires_in.unwrap_or(3600) as u64,
        };
        self.token_cache
            .lock()
            .await
            .insert(secret.client_email.clone(), cached);
        Ok(tok.access_token)
    }
}

#[derive(Clone)]
struct CachedToken {
    access_token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct FcmConfig {
    project_id: String,
}

#[derive(Deserialize)]
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
    if msg.title.is_some() || msg.body.is_some() {
        let mut notif = serde_json::Map::new();
        if let Some(t) = msg.title.as_ref() {
            notif.insert("title".into(), Value::String(t.clone()));
        }
        if let Some(b) = msg.body.as_ref() {
            notif.insert("body".into(), Value::String(b.clone()));
        }
        message.insert("notification".into(), Value::Object(notif));
    }
    // FCM requires data values to be strings.
    if let Some(Value::Object(data)) = msg.data.as_ref() {
        let mut stringified = serde_json::Map::new();
        for (k, v) in data.iter() {
            let s = match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            stringified.insert(k.clone(), Value::String(s));
        }
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
    if let Some(chan) = msg.options.channel_id.as_ref() {
        let mut notif_android = serde_json::Map::new();
        notif_android.insert("channel_id".into(), Value::String(chan.clone()));
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
    fn extract_fcm_error_falls_back_to_status() {
        let body = r#"{"error":{"status":"UNAVAILABLE"}}"#;
        assert_eq!(extract_fcm_error(body).as_deref(), Some("UNAVAILABLE"));
    }
}
