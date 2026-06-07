// v2.8 — Web Push (RFC 8030) provider.
//
// Lights in v2.8 alongside the `sentori-javascript` Service Worker.
// Auth: VAPID JWT (ES256), claims `{aud, exp, sub}`. Payload is
// AES-GCM encrypted under the browser's subscription
// p256dh + auth keys (RFC 8291).
//
// This file is a placeholder so the dispatcher's match arm exists
// and provider selection doesn't need a v2.8 patch on the dispatcher.

use async_trait::async_trait;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult};
use crate::push::types::NativeMessage;

pub struct WebPushProvider;

impl WebPushProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for WebPushProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for WebPushProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::WebPush
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
