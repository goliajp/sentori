// v1.2 W7.c — GitLab Issues adapter.
//
// Auth: per-org Personal Access Token (`PRIVATE-TOKEN` header).
// Required scopes: `api` (full) or `read_api + write_repository` for
// fine-grained tokens. Self-hosted GitLab works the same: operator
// supplies their instance's base URL.
//
// Inbound webhook auth: GitLab uses a plain `X-Gitlab-Token` header
// equal to the configured secret string — no HMAC. Constant-time
// compared against `SENTORI_GITLAB_WEBHOOK_SECRET`.
//
// API surface used:
//   POST {base}/api/v4/projects/:id/issues
//   PUT  {base}/api/v4/projects/:id/issues/:iid?state_event=close|reopen
//   POST {base}/api/v4/projects/:id/issues/:iid/notes (regression comment)

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{ExternalRef, IntegrationAdapter, IntegrationError, IssueContext, IssueLifecycleEvent};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitlabConfig {
    /// Personal Access Token. Required.
    pub access_token: String,
    /// Base URL of the GitLab instance. Defaults to gitlab.com when
    /// blank.
    #[serde(default)]
    pub base_url: String,
    /// Project ID or URL-encoded `group/project` slug. Required.
    pub project_id: String,
}

pub struct GitlabAdapter {
    pub webhook_secret: Option<String>,
}

impl GitlabAdapter {
    pub fn from_env() -> Option<Self> {
        let webhook_secret = std::env::var("SENTORI_GITLAB_WEBHOOK_SECRET")
            .ok()
            .filter(|s| !s.is_empty());
        Some(Self { webhook_secret })
    }

    pub fn verify_webhook_token(&self, provided: &str) -> bool {
        let Some(secret) = self.webhook_secret.as_deref() else {
            return false;
        };
        constant_time_eq(secret.as_bytes(), provided.as_bytes())
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn base_url_of(cfg: &GitlabConfig) -> String {
    let raw = if cfg.base_url.is_empty() {
        "https://gitlab.com"
    } else {
        &cfg.base_url
    };
    raw.trim_end_matches('/').to_string()
}

#[async_trait]
impl IntegrationAdapter for GitlabAdapter {
    fn kind(&self) -> &'static str {
        "gitlab"
    }

    fn is_configured(&self) -> bool {
        true
    }

    fn connect_mode(&self) -> super::ConnectMode {
        super::ConnectMode::Manual
    }

    fn oauth_authorise_url(&self, _state: &str, _redirect_uri: &str) -> String {
        String::new()
    }

    async fn exchange_code(
        &self,
        _code: &str,
        _redirect_uri: &str,
    ) -> Result<serde_json::Value, IntegrationError> {
        Err(IntegrationError::Upstream("gitlab uses manual config".into()))
    }

    async fn accept_manual_config(
        &self,
        form: serde_json::Value,
    ) -> Result<serde_json::Value, IntegrationError> {
        let cfg: GitlabConfig = serde_json::from_value(form)
            .map_err(|e| IntegrationError::Upstream(format!("bad gitlab config: {e}")))?;
        if cfg.access_token.is_empty() {
            return Err(IntegrationError::Upstream("accessToken is required".into()));
        }
        if cfg.project_id.is_empty() {
            return Err(IntegrationError::Upstream("projectId is required".into()));
        }
        Ok(serde_json::to_value(&cfg).map_err(|e| IntegrationError::Upstream(e.to_string()))?)
    }

    async fn create_issue(
        &self,
        config: &serde_json::Value,
        ctx: &IssueContext,
    ) -> Result<ExternalRef, IntegrationError> {
        let cfg: GitlabConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("config: {e}")))?;
        let base = base_url_of(&cfg);
        let project_id_enc = urlencoding::encode(&cfg.project_id);
        let url = format!("{base}/api/v4/projects/{project_id_enc}/issues");
        let body = json!({
            "title": format!("{}: {}", ctx.error_type, ctx.error_message),
            "description": format!(
                "**Sentori** issue `{}`\n\n[Open in Sentori]({})\n\n\
                 Release: `{}` · env: `{}` · events seen: {}\n{}",
                ctx.issue_id, ctx.url, ctx.release, ctx.environment, ctx.event_count,
                ctx.crash_site
                    .as_ref()
                    .map(|c| format!("Crash site: `{c}`"))
                    .unwrap_or_default(),
            ),
        });
        let resp = reqwest::Client::new()
            .post(&url)
            .header("PRIVATE-TOKEN", &cfg.access_token)
            .header("User-Agent", "sentori-integration")
            .json(&body)
            .send()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "gitlab create issue {}",
                resp.status()
            )));
        }
        let parsed: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        let iid = parsed
            .get("iid")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| IntegrationError::Upstream("missing iid".into()))?;
        let web_url = parsed
            .get("web_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| IntegrationError::Upstream("missing web_url".into()))?
            .to_string();
        Ok(ExternalRef {
            external_id: format!("{}#{}", cfg.project_id, iid),
            external_url: web_url,
        })
    }

    async fn update_status(
        &self,
        config: &serde_json::Value,
        external_id: &str,
        event: IssueLifecycleEvent,
    ) -> Result<(), IntegrationError> {
        let cfg: GitlabConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("config: {e}")))?;
        let base = base_url_of(&cfg);
        // external_id = "<projectId>#<iid>".
        let (project_id, iid) = external_id
            .rsplit_once('#')
            .ok_or_else(|| IntegrationError::Upstream("bad external_id".into()))?;
        let project_id_enc = urlencoding::encode(project_id);
        let url = format!("{base}/api/v4/projects/{project_id_enc}/issues/{iid}");
        let state_event = match event {
            IssueLifecycleEvent::Resolved => "close",
            IssueLifecycleEvent::Regressed | IssueLifecycleEvent::Created => "reopen",
        };
        let client = reqwest::Client::new();
        let resp = client
            .put(&url)
            .header("PRIVATE-TOKEN", &cfg.access_token)
            .header("User-Agent", "sentori-integration")
            .json(&json!({ "state_event": state_event }))
            .send()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "gitlab update state {}",
                resp.status()
            )));
        }
        if matches!(event, IssueLifecycleEvent::Regressed) {
            let notes_url =
                format!("{base}/api/v4/projects/{project_id_enc}/issues/{iid}/notes");
            let _ = client
                .post(&notes_url)
                .header("PRIVATE-TOKEN", &cfg.access_token)
                .header("User-Agent", "sentori-integration")
                .json(&json!({ "body": "Sentori reopened: this error regressed in a new event." }))
                .send()
                .await;
        }
        Ok(())
    }
}
