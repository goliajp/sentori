// v2.7 — Provider trait + outcome types.
//
// Each concrete provider implements `Provider::send` over a fully-
// normalised `NativeMessage` + decrypted credential payload. The
// dispatcher consumes the trait — it knows nothing about APNs JWT
// or FCM OAuth.

use async_trait::async_trait;
use std::sync::Arc;
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

/// v2.19 — one credential-validation attempt's result. Drives the
/// dashboard's "is this row green?" indicator.
#[derive(Debug, Clone)]
pub enum ValidateOutcome {
    /// Parse + (where applicable) auth challenge succeeded.
    Ok,
    /// Cred shape parses but auth/identity challenge was rejected
    /// by the vendor — caller almost certainly has a stale or wrong
    /// secret.
    Rejected { reason: String },
    /// Cred shape itself is malformed (missing fields, bad PEM, etc.).
    Malformed { reason: String },
    /// Network unreachable / timeout. Caller is told "unknown — try
    /// again" rather than "broken".
    Unreachable { reason: String },
    /// Provider doesn't expose a fast validation path. The cred shape
    /// parsed, that's all we can say. UI treats it as "unverified".
    NotImplemented,
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

    /// v2.19 — fast credential validation. Parses the shape and,
    /// where the vendor exposes a cheap auth challenge (FCM/HCM
    /// OAuth mint), exercises it. Should complete in < 1 s on the
    /// happy path. Default impl returns `NotImplemented`.
    async fn validate(&self, _cred: Credential<'_>) -> ValidateOutcome {
        ValidateOutcome::NotImplemented
    }
}

/// Process-wide provider registry. Built once on startup with the
/// shared http_client. Providers internal to v2.7 (APNs, FCM) hold
/// caches inside their own struct (FCM's OAuth token cache); the
/// others are stateless stubs until their lens-specific release.
pub struct Providers {
    pub apns: Arc<dyn Provider>,
    pub fcm: Arc<dyn Provider>,
    pub webpush: Arc<dyn Provider>,
    pub hcm: Arc<dyn Provider>,
    pub mipush: Arc<dyn Provider>,
}

impl Providers {
    pub fn new(http_client: reqwest::Client) -> Self {
        Self {
            apns: Arc::new(apns::ApnsProvider::new(http_client.clone())),
            fcm: Arc::new(fcm::FcmProvider::new(http_client.clone())),
            webpush: Arc::new(webpush::WebPushProvider::new(http_client.clone())),
            hcm: Arc::new(hcm::HcmProvider::new(http_client.clone())),
            mipush: Arc::new(mipush::MiPushProvider::new(http_client)),
        }
    }

    pub fn pick(&self, kind: ProviderKind) -> &Arc<dyn Provider> {
        match kind {
            ProviderKind::Apns => &self.apns,
            ProviderKind::Fcm => &self.fcm,
            ProviderKind::WebPush => &self.webpush,
            ProviderKind::Hcm => &self.hcm,
            ProviderKind::MiPush => &self.mipush,
        }
    }
}
