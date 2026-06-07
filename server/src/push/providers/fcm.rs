// v2.7 W5 — Firebase Cloud Messaging v1 provider.
//
// Auth: 2-step OAuth.
//   1. Build RS256 JWT signed with the service account's
//      `private_key`, claims `{iss, scope: "https://www.googleapis.com/auth/firebase.messaging",
//      aud: token_uri, iat, exp}`.
//   2. POST `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>`
//      to the service-account `token_uri` (https://oauth2.googleapis.com/token).
//   3. Cache the returned access_token for `expires_in - 60s`.
//
// Transport: POST to
//   https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
// with the access token in `Authorization: Bearer ...`.
//
// Body shape:
//   {
//     "message": {
//       "token": "<fcm registration token>",
//       "notification": { "title": "...", "body": "..." },
//       "data": { "key": "string-value", ... },         // all values must be strings
//       "android": { "priority": "high", "collapse_key": "...", "ttl": "3600s" },
//       "apns": { ... },                                 // for FCM-via-APNs setups
//       "webpush": { ... }                               // for FCM-to-web routes (unused here)
//     }
//   }
//
// Outcome classification (per Firebase docs):
//   200                        → Sent ("FCM_200")
//   404 UNREGISTERED           → PermanentlyInvalidToken
//   400 INVALID_ARGUMENT       → TerminalOther
//   401 UNAUTHENTICATED        → TerminalOther (credential probably revoked)
//   403 SENDER_ID_MISMATCH     → PermanentlyInvalidToken (this token
//                                belongs to a different sender)
//   429 QUOTA_EXCEEDED         → Transient(retry_after from header)
//   500/503                    → Transient(None)

use async_trait::async_trait;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult};
use crate::push::types::NativeMessage;

pub struct FcmProvider {
    // Production impl holds shared reqwest::Client + access-token
    // cache. Placeholder for v2.7 foundation commit.
}

impl FcmProvider {
    pub fn new() -> Self {
        Self {}
    }
}

impl Default for FcmProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for FcmProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Fcm
    }

    async fn send(
        &self,
        _cred: Credential<'_>,
        _native_token: &str,
        _env: Option<&str>,
        _msg: &NativeMessage,
    ) -> Result<ProviderResult, ProviderError> {
        Err(ProviderError::NotImplemented)
    }
}
