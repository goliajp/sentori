// v2.7 — Provider trait + outcome types.
//
// Each concrete provider implements `Provider::send` over a fully-
// normalised `NativeMessage` + decrypted credential payload. The
// dispatcher consumes the trait — it knows nothing about APNs JWT
// or FCM OAuth.

use async_trait::async_trait;
use thiserror::Error;

use crate::push::types::NativeMessage;

pub mod apns;
pub mod fcm;
pub mod hcm;
pub mod mipush;
pub mod webpush;

/// Provider discriminator stored in DB rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Apns,
    Fcm,
    WebPush,
    Hcm,
    MiPush,
}

impl ProviderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderKind::Apns => "apns",
            ProviderKind::Fcm => "fcm",
            ProviderKind::WebPush => "webpush",
            ProviderKind::Hcm => "hcm",
            ProviderKind::MiPush => "mipush",
        }
    }

    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "apns" => Some(ProviderKind::Apns),
            "fcm" => Some(ProviderKind::Fcm),
            "webpush" => Some(ProviderKind::WebPush),
            "hcm" => Some(ProviderKind::Hcm),
            "mipush" => Some(ProviderKind::MiPush),
            _ => None,
        }
    }
}

/// What the dispatcher needs from each per-(project, provider) row.
/// `config` is the non-secret JSONB (key id, project id, env default,
/// etc.); `secret_payload` is the post-decryption plaintext bytes
/// (provider-specific shape, see push_credentials migration).
#[derive(Debug, Clone)]
pub struct Credential<'a> {
    pub config: &'a serde_json::Value,
    pub secret_payload: &'a [u8],
}

/// What a dispatch attempt yielded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    /// Token is dead — drop it (and bump the bad_streak counter).
    PermanentlyInvalidToken,
    /// Token was registered as sandbox/production but the provider
    /// said the other. Caller can either retry on the other env or
    /// surface to the operator. We mark as failed for now.
    EnvironmentMismatch,
    /// Retry — providers said try again, optionally after this many
    /// seconds. None means "use our default schedule".
    Transient { retry_after_secs: Option<i32> },
    /// Some other terminal error (auth failure, malformed payload,
    /// quota exhausted permanently). Caller fails the send.
    TerminalOther { reason: String },
}

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider not implemented yet (v2.7 ships APNs + FCM only)")]
    NotImplemented,
    #[error("credential malformed: {0}")]
    CredentialMalformed(String),
    #[error("payload malformed: {0}")]
    PayloadMalformed(String),
    #[error("http transport: {0}")]
    HttpTransport(String),
    #[error("internal: {0}")]
    Internal(String),
}

/// One dispatch's full result: what the dispatcher needs to know.
pub struct ProviderResult {
    pub outcome: SendOutcome,
    /// Stable string used for `push_sends.provider_outcome` and
    /// `push_delivery_logs.outcome`. e.g. "APNS_200", "FCM_403", etc.
    pub provider_outcome_label: String,
    /// HTTP status, when applicable.
    pub provider_status: Option<i32>,
    /// Truncated provider body (≤ 2 KB) for `push_delivery_logs`.
    pub provider_body: Option<String>,
    /// Round-trip duration of the dispatch attempt.
    pub duration_ms: i32,
}

#[async_trait]
pub trait Provider: Send + Sync {
    fn kind(&self) -> ProviderKind;

    /// Send one message to one native token. `native_token` is the
    /// raw provider token (APNs hex device token, FCM registration
    /// id, web subscription endpoint, etc.) — not the `ipt_*` handle.
    async fn send(
        &self,
        cred: Credential<'_>,
        native_token: &str,
        env: Option<&str>,
        msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError>;
}
