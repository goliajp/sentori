// v2.12 — Huawei Mobile Services (HMS) Push Kit provider.
//
// Lights in v2.12 alongside MiPush. Auth: HMS OAuth (POST
// `grant_type=client_credentials` to https://oauth-login.cloud.huawei.com/oauth2/v3/token).
//
// Placeholder so dispatch arms exist; real impl in v2.12.

use async_trait::async_trait;

use super::{Credential, Provider, ProviderError, ProviderKind, ProviderResult};
use crate::push::types::NativeMessage;

pub struct HcmProvider;

impl HcmProvider {
    pub fn new() -> Self {
        Self
    }
}

impl Default for HcmProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Provider for HcmProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Hcm
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
