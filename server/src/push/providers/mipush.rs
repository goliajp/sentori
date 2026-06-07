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

pub struct MiPushProvider {
    #[allow(dead_code)]
    http_client: reqwest::Client,
}

impl MiPushProvider {
    pub fn new(http_client: reqwest::Client) -> Self {
        Self { http_client }
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
