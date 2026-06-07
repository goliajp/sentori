// v2.12 — Huawei HMS Push Kit provider.
//
// Targets HMS Core Push (the system push service on Huawei devices
// post-HMS split from Google Play Services). Required for Chinese
// market where Huawei devices lack FCM.
//
// Auth: OAuth `client_credentials`. POST
// `https://oauth-login.cloud.huawei.com/oauth2/v3/token` with
// `grant_type=client_credentials&client_id=<app_id>&client_secret=<app_secret>`
// → `{ access_token, expires_in }`. Cache for `expires_in - 60s`.
//
// Transport: POST
// `https://push-api.cloud.huawei.com/v1/<app_id>/messages:send`
// with `Authorization: Bearer <access_token>`.
//
// Body: HMS message envelope —
// `{ "message": { "token": ["<reg_id>"], "notification": { title, body }, "data": "<string>", "android": { collapse_key, priority: HIGH|NORMAL, ttl } } }`.
// Note: HMS requires `data` to be a JSON-encoded STRING (unlike FCM
// which accepts a map). And `token` is always an array.
//
// Outcome classification (per HMS docs):
//   200 + code "80000000"     → Sent
//   200 + code "80200001"     → PermanentlyInvalidToken (token invalid)
//   200 + code "80200003"     → PermanentlyInvalidToken (token has expired)
//   200 + code "80300008"     → TerminalOther("MessageTooBig")
//   200 + code "80100003"     → Transient (illegal target / temporary)
//   401                       → TerminalOther("OAuth expired")
//   429                       → Transient(retry_after)
//   5xx                       → Transient
//   other                     → TerminalOther("HCM_<code>")

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult, SendOutcome};
use crate::push::types::{NativeMessage, Priority};

const HCM_OAUTH_URL: &str = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
const HCM_SEND_BASE: &str = "https://push-api.cloud.huawei.com/v1";

pub struct HcmProvider {
    http_client: reqwest::Client,
    token_cache: Arc<Mutex<std::collections::HashMap<String, CachedToken>>>,
}

impl HcmProvider {
    pub fn new(http_client: reqwest::Client) -> Self {
        Self {
            http_client,
            token_cache: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    async fn access_token(&self, app_id: &str, app_secret: &str) -> Result<String, ProviderError> {
        let now = now_secs();
        {
            let cache = self.token_cache.lock().await;
            if let Some(t) = cache.get(app_id) {
                if t.expires_at > now + 60 {
                    return Ok(t.access_token.clone());
                }
            }
        }
        let resp = self
            .http_client
            .post(HCM_OAUTH_URL)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", app_id),
                ("client_secret", app_secret),
            ])
            .send()
            .await
            .map_err(|e| ProviderError::HttpTransport(format!("oauth: {e}")))?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::CredentialMalformed(format!(
                "hcm oauth {status}: {}",
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
        self.token_cache.lock().await.insert(app_id.into(), cached);
        Ok(tok.access_token)
    }
}

#[derive(Clone)]
struct CachedToken {
    access_token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct HcmConfig {
    app_id: String,
}

#[derive(Deserialize)]
struct HcmSecret {
    app_secret: String,
}

#[derive(Serialize, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct HmsSendResponse {
    code: String,
    #[allow(dead_code)]
    msg: Option<String>,
}

#[async_trait]
impl Provider for HcmProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Hcm
    }

    async fn send(
        &self,
        cred: Credential<'_>,
        native_token: &str,
        _env: Option<&str>,
        msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError> {
        let config: HcmConfig = serde_json::from_value(cred.config.clone())
            .map_err(|e| ProviderError::CredentialMalformed(format!("config: {e}")))?;
        let secret: HcmSecret = serde_json::from_slice(cred.secret_payload)
            .map_err(|e| ProviderError::CredentialMalformed(format!("secret: {e}")))?;
        let access_token = self.access_token(&config.app_id, &secret.app_secret).await?;

        let body = build_hms_message(native_token, msg);
        let url = format!("{HCM_SEND_BASE}/{}/messages:send", config.app_id);
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

        // HMS returns 200 even for application-level errors; the
        // `code` field carries the actual outcome.
        let hms_code = serde_json::from_str::<HmsSendResponse>(&raw_body)
            .ok()
            .map(|r| r.code);
        let (outcome, label) = classify(status.as_u16(), hms_code.as_deref(), retry_after);
        Ok(ProviderResult {
            outcome,
            provider_outcome_label: label,
            provider_status: Some(status.as_u16() as i32),
            provider_body: Some(truncate_2k(&raw_body)),
            duration_ms,
        })
    }
}

fn build_hms_message(native_token: &str, msg: &NativeMessage) -> Value {
    let mut message = serde_json::Map::new();
    message.insert("token".into(), json!([native_token]));
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
    // HMS requires data as a STRING (JSON-encoded). Pack the
    // NativeMessage.data into a JSON string.
    if let Some(data) = msg.data.as_ref() {
        if let Ok(s) = serde_json::to_string(data) {
            message.insert("data".into(), Value::String(s));
        }
    }
    let mut android = serde_json::Map::new();
    if matches!(msg.options.priority, Some(Priority::High)) {
        android.insert("urgency".into(), Value::String("HIGH".into()));
    }
    if let Some(c) = msg.options.collapse_key.as_ref() {
        android.insert("collapse_key".into(), Value::String(c.clone()));
    }
    if let Some(ttl) = msg.options.ttl {
        android.insert("ttl".into(), Value::String(format!("{}s", ttl.max(0))));
    }
    if !android.is_empty() {
        message.insert("android".into(), Value::Object(android));
    }
    json!({ "validate_only": false, "message": Value::Object(message) })
}

fn classify(
    http_status: u16,
    hms_code: Option<&str>,
    retry_after: Option<i32>,
) -> (SendOutcome, String) {
    match http_status {
        200 => match hms_code {
            Some("80000000") => (SendOutcome::Sent, "HCM_80000000".into()),
            Some(code @ "80200001") | Some(code @ "80200003") => (
                SendOutcome::PermanentlyInvalidToken,
                format!("HCM_{code}_TokenInvalid"),
            ),
            Some("80300008") => (
                SendOutcome::TerminalOther {
                    reason: "MessageTooBig".into(),
                },
                "HCM_80300008_PayloadTooBig".into(),
            ),
            Some(code @ "80100003") => (
                SendOutcome::Transient { retry_after_secs: retry_after },
                format!("HCM_{code}_Transient"),
            ),
            Some(code) => (
                SendOutcome::TerminalOther {
                    reason: format!("HCM_{code}"),
                },
                format!("HCM_{code}"),
            ),
            None => (
                SendOutcome::TerminalOther {
                    reason: "HCM_200: no code in body".into(),
                },
                "HCM_200_NoCode".into(),
            ),
        },
        401 => (
            SendOutcome::TerminalOther {
                reason: "HCM_401_OAuthExpired".into(),
            },
            "HCM_401".into(),
        ),
        429 => (
            SendOutcome::Transient { retry_after_secs: retry_after },
            "HCM_429_RateLimited".into(),
        ),
        s if (500..=599).contains(&s) => (
            SendOutcome::Transient { retry_after_secs: retry_after },
            format!("HCM_{s}"),
        ),
        s => (
            SendOutcome::TerminalOther {
                reason: format!("HCM_{s}"),
            },
            format!("HCM_{s}"),
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
    fn classify_sent() {
        let (o, l) = classify(200, Some("80000000"), None);
        assert_eq!(o, SendOutcome::Sent);
        assert_eq!(l, "HCM_80000000");
    }

    #[test]
    fn classify_token_invalid() {
        let (o, _) = classify(200, Some("80200001"), None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
        let (o, _) = classify(200, Some("80200003"), None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
    }

    #[test]
    fn classify_message_too_big() {
        let (o, _) = classify(200, Some("80300008"), None);
        assert!(matches!(o, SendOutcome::TerminalOther { reason } if reason == "MessageTooBig"));
    }

    #[test]
    fn classify_transient_inline() {
        let (o, _) = classify(200, Some("80100003"), Some(60));
        assert_eq!(
            o,
            SendOutcome::Transient { retry_after_secs: Some(60) }
        );
    }

    #[test]
    fn classify_429_transient() {
        let (o, _) = classify(429, None, Some(30));
        assert_eq!(
            o,
            SendOutcome::Transient { retry_after_secs: Some(30) }
        );
    }

    #[test]
    fn build_hms_message_packs_token_array_and_data_string() {
        let msg = NativeMessage {
            to: crate::push::types::ToField::Single("ipt_x".into()),
            title: Some("Hi".into()),
            body: Some("Hello".into()),
            data: Some(serde_json::json!({ "id": "abc", "count": 3 })),
            options: crate::push::types::NativeOptions {
                priority: Some(Priority::High),
                ttl: Some(600),
                collapse_key: Some("c1".into()),
                ..Default::default()
            },
            idempotency_key: None,
        };
        let v = build_hms_message("HMS_REGID", &msg);
        let m = v.get("message").unwrap();
        // HMS wants token as an array.
        assert_eq!(m["token"], serde_json::json!(["HMS_REGID"]));
        assert_eq!(m["notification"]["title"], "Hi");
        // Data must be a JSON-encoded STRING per HMS spec.
        assert!(m["data"].is_string());
        let inner: serde_json::Value =
            serde_json::from_str(m["data"].as_str().unwrap()).unwrap();
        assert_eq!(inner["id"], "abc");
        assert_eq!(inner["count"], 3);
        assert_eq!(m["android"]["urgency"], "HIGH");
        assert_eq!(m["android"]["collapse_key"], "c1");
        assert_eq!(m["android"]["ttl"], "600s");
    }
}
