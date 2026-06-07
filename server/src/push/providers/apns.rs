// v2.7 W4 — Apple Push Notification service provider.
//
// Auth: ES256 JWT signed with the project's APNs p8 private key, key
// id + team id from `config`. JWT is cached for ~50 min (Apple
// requires < 1 h) on the per-(project, provider) ProviderRuntime.
//
// Transport: HTTP/2 POST to
//   https://api.push.apple.com/3/device/{native_token}                (prod)
//   https://api.sandbox.push.apple.com/3/device/{native_token}        (sandbox)
//
// Headers:
//   authorization:    bearer <jwt>
//   apns-topic:       <bundleId>
//   apns-push-type:   alert | background
//   apns-priority:    10 (high) | 5 (normal)
//   apns-expiration:  unix-secs (or 0 for "don't deliver if can't immediately")
//   apns-collapse-id: from NativeOptions.collapse_key
//
// Body: APS payload JSON
//   {
//     "aps": {
//       "alert": { "title": "...", "body": "..." },
//       "sound": "default",
//       "badge": 3,
//       "mutable-content": 1,
//       "content-available": 1,
//       "category": "MESSAGE_CATEGORY"
//     },
//     // arbitrary custom data fields:
//     "url": "...", "issueId": "..."
//   }
//
// Outcome classification:
//   200            → SendOutcome::Sent (label "APNS_200")
//   400 + 'BadDeviceToken'       → PermanentlyInvalidToken
//   400 + 'BadEnvironmentKeyInToken' → EnvironmentMismatch
//   410            → PermanentlyInvalidToken  (token unregistered by user)
//   413            → TerminalOther("MessageTooBig") — APNs caps at 4 KB / 5 KB
//   429            → Transient(retry_after_secs from Retry-After header)
//   5xx            → Transient(None)
//   other          → TerminalOther("APNS_<status>: <reason>")

use async_trait::async_trait;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult};
use crate::push::types::NativeMessage;

pub struct ApnsProvider {
    // Production impl will hold the shared reqwest::Client +
    // a JWT cache in `Arc<Mutex<...>>`. Placeholder for v2.7
    // foundation commit.
}

impl ApnsProvider {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for ApnsProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for ApnsProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Apns
    }

    async fn send(
        &self,
        _cred: Credential<'_>,
        _native_token: &str,
        _env: Option<&str>,
        _msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError> {
        // v2.7 foundation commit — wire-up to come in the same
        // version (W4 follow-up). Returning NotImplemented keeps
        // the dispatcher's path testable end-to-end without making
        // a real network call.
        Err(ProviderError::NotImplemented)
    }
}
