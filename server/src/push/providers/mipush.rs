// v2.12 — Xiaomi MiPush provider.
//
// Lights in v2.12 alongside HCM. Auth: AppSecret header. Transport:
// POST https://api.xmpush.xiaomi.com/v3/message/regid (CN region) or
// .global. for international.
//
// Placeholder so dispatch arms exist; real impl in v2.12.

use async_trait::async_trait;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult};
use crate::push::types::NativeMessage;

pub struct MiPushProvider;

impl MiPushProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for MiPushProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for MiPushProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::MiPush
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
