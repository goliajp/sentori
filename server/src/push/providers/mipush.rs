// v2.12 — Xiaomi MiPush provider.
//
// Targets MIUI's system push service. Required for Xiaomi devices
// in China where FCM isn't available.
//
// Auth: `Authorization: key=<AppSecret>` header. No OAuth — much
// simpler than HCM.
//
// Transport: POST to
//   `https://api.xmpush.xiaomi.com/v3/message/regid`     (CN region, default)
//   `https://api.global.xmpush.xiaomi.com/v3/message/regid` (global)
// with `application/x-www-form-urlencoded` body fields:
//   registration_id   — comma-separated reg ids (we send one)
//   payload           — JSON-encoded data string
//   title             — notification title
//   description       — notification body
//   pass_through      — 0 (notification) | 1 (data-only)
//   restricted_package_name — host app package
//   notify_type       — bitmask 1=sound 2=vibrate 4=light, sum or -1=all
//   time_to_live      — ms (not s!)
//
// Outcome classification (per Xiaomi docs):
//   200 + result "ok" + code 0       → Sent
//   200 + code 22000                 → PermanentlyInvalidToken (invalid regid)
//   200 + code 22020                 → Transient (rate limited)
//   200 + code 22021                 → TerminalOther("MessageTooBig")
//   401                              → TerminalOther("AppSecret rejected")
//   429                              → Transient
//   5xx                              → Transient
//   other                            → TerminalOther

use async_trait::async_trait;
use serde::Deserialize;
use std::time::Instant;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult, SendOutcome};
use crate::push::types::{NativeMessage, Priority};

const MIPUSH_URL_CN: &str = "https://api.xmpush.xiaomi.com/v3/message/regid";
const MIPUSH_URL_GLOBAL: &str = "https://api.global.xmpush.xiaomi.com/v3/message/regid";

pub struct MiPushProvider {
    http_client: reqwest::Client,
}

impl MiPushProvider {
    pub fn new(http_client: reqwest::Client) -> Self {
        Self { http_client }
    }
}

#[derive(Deserialize)]
struct MiPushConfig {
    /// Host app's package name; MiPush enforces routing per package.
    package_name: String,
    /// `"cn"` (default) or `"global"`. Selects the endpoint host.
    #[serde(default = "default_region")]
    region: String,
}

fn default_region() -> String {
    "cn".into()
}

#[derive(Deserialize)]
struct MiPushSecret {
    app_secret: String,
}

#[derive(Deserialize)]
struct MiPushSendResponse {
    code: Option<i64>,
    result: Option<String>,
    #[allow(dead_code)]
    reason: Option<String>,
}

#[async_trait]
impl Provider for MiPushProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::MiPush
    }

    async fn send(
        &self,
        cred: Credential<'_>,
        native_token: &str,
        _env: Option<&str>,
        msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError> {
        let config: MiPushConfig = serde_json::from_value(cred.config.clone())
            .map_err(|e| ProviderError::CredentialMalformed(format!("config: {e}")))?;
        let secret: MiPushSecret = serde_json::from_slice(cred.secret_payload)
            .map_err(|e| ProviderError::CredentialMalformed(format!("secret: {e}")))?;
        let endpoint = match config.region.as_str() {
            "global" => MIPUSH_URL_GLOBAL,
            _ => MIPUSH_URL_CN,
        };

        let payload_json = msg
            .data
            .as_ref()
            .and_then(|d| serde_json::to_string(d).ok())
            .unwrap_or_else(|| "{}".to_string());
        let ttl_ms = msg.options.ttl.map(|s| (s.max(0) as i64) * 1000);
        let notify_type = match msg.options.priority {
            Some(Priority::High) => "-1",
            _ => "1",
        };

        let mut form: Vec<(&str, String)> = vec![
            ("registration_id", native_token.into()),
            ("payload", payload_json),
            ("restricted_package_name", config.package_name.clone()),
            ("pass_through", "0".into()),
            ("notify_type", notify_type.into()),
        ];
        if let Some(t) = msg.title.as_ref() {
            form.push(("title", t.clone()));
        }
        if let Some(b) = msg.body.as_ref() {
            form.push(("description", b.clone()));
        }
        if let Some(ttl) = ttl_ms {
            form.push(("time_to_live", ttl.to_string()));
        }

        let t0 = Instant::now();
        let resp = self
            .http_client
            .post(endpoint)
            .header("Authorization", format!("key={}", secret.app_secret))
            .form(&form)
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

        let parsed = serde_json::from_str::<MiPushSendResponse>(&raw_body).ok();
        let (outcome, label) = classify(
            status.as_u16(),
            parsed.as_ref().and_then(|p| p.code),
            parsed.as_ref().and_then(|p| p.result.as_deref()),
            retry_after,
        );
        Ok(ProviderResult {
            outcome,
            provider_outcome_label: label,
            provider_status: Some(status.as_u16() as i32),
            provider_body: Some(truncate_2k(&raw_body)),
            duration_ms,
        })
    }
}

fn classify(
    http_status: u16,
    code: Option<i64>,
    result: Option<&str>,
    retry_after: Option<i32>,
) -> (SendOutcome, String) {
    match http_status {
        200 => match (code, result) {
            (Some(0), Some("ok")) => (SendOutcome::Sent, "MIPUSH_0_OK".into()),
            (Some(22000), _) => (
                SendOutcome::PermanentlyInvalidToken,
                "MIPUSH_22000_InvalidRegid".into(),
            ),
            (Some(22020), _) => (
                SendOutcome::Transient { retry_after_secs: retry_after },
                "MIPUSH_22020_RateLimited".into(),
            ),
            (Some(22021), _) => (
                SendOutcome::TerminalOther {
                    reason: "MessageTooBig".into(),
                },
                "MIPUSH_22021_PayloadTooBig".into(),
            ),
            (Some(c), _) => (
                SendOutcome::TerminalOther {
                    reason: format!("MIPUSH_{c}"),
                },
                format!("MIPUSH_{c}"),
            ),
            (None, _) => (
                SendOutcome::TerminalOther {
                    reason: "MIPUSH_200_NoCode".into(),
                },
                "MIPUSH_200_NoCode".into(),
            ),
        },
        401 => (
            SendOutcome::TerminalOther {
                reason: "MIPUSH_401_AppSecretRejected".into(),
            },
            "MIPUSH_401".into(),
        ),
        429 => (
            SendOutcome::Transient { retry_after_secs: retry_after },
            "MIPUSH_429_RateLimited".into(),
        ),
        s if (500..=599).contains(&s) => (
            SendOutcome::Transient { retry_after_secs: retry_after },
            format!("MIPUSH_{s}"),
        ),
        s => (
            SendOutcome::TerminalOther {
                reason: format!("MIPUSH_{s}"),
            },
            format!("MIPUSH_{s}"),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_ok() {
        let (o, l) = classify(200, Some(0), Some("ok"), None);
        assert_eq!(o, SendOutcome::Sent);
        assert_eq!(l, "MIPUSH_0_OK");
    }

    #[test]
    fn classify_invalid_regid() {
        let (o, _) = classify(200, Some(22000), None, None);
        assert_eq!(o, SendOutcome::PermanentlyInvalidToken);
    }

    #[test]
    fn classify_rate_limited_inline() {
        let (o, _) = classify(200, Some(22020), None, Some(60));
        assert_eq!(
            o,
            SendOutcome::Transient { retry_after_secs: Some(60) }
        );
    }

    #[test]
    fn classify_message_too_big() {
        let (o, _) = classify(200, Some(22021), None, None);
        assert!(matches!(o, SendOutcome::TerminalOther { reason } if reason == "MessageTooBig"));
    }

    #[test]
    fn classify_401_rejected() {
        let (o, _) = classify(401, None, None, None);
        assert!(matches!(o, SendOutcome::TerminalOther { .. }));
    }
}
