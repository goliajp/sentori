// v1.2 W7.d — Jira Cloud adapter.
//
// Auth: Atlassian API token + email, sent as HTTP basic auth
// (base64 of `email:api_token`). Atlassian docs:
// https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
//
// API base: each workspace lives at https://<site>.atlassian.net.
// Stored in config + used per-call.
//
// Inbound webhook: Jira Cloud webhooks don't sign payloads — they
// rely on a per-webhook URL secret (i.e. the URL itself must be
// unguessable). We treat `SENTORI_JIRA_WEBHOOK_SECRET` as a path
// segment requirement: receivers route `/v1/integrations/jira/
// webhook?secret=<env>` and reject mismatches. Not as strong as HMAC
// but it's the protocol Jira gives us; complement with TLS + a long
// random secret.
//
// Status transitions: Jira workflows are project-specific. We
// resolve transitions by *name* — "Done" closes, "To Do" / "In
// Progress" reopens. Misconfigured workflows (no transition with
// those names) surface as a warning.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{ExternalRef, IntegrationAdapter, IntegrationError, IssueContext, IssueLifecycleEvent};

/// v1.3 W12 + v1.4 W20 — Jira Cloud (OAuth), Jira Cloud (API token),
/// or Jira Server / DC.
///
/// - Cloud-OAuth uses Atlassian 3LO + a refresh token; API calls go
///   through `https://api.atlassian.com/ex/jira/{cloud_id}` after the
///   accessible-resources lookup.
/// - Cloud-API-token uses email + API token (basic auth) and a
///   workspace `<site>.atlassian.net` URL. Same as v1.3 W12 shape.
/// - Server / DC uses a Personal Access Token (Bearer) with an
///   operator-supplied base URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "deployment")]
pub enum JiraConfig {
    #[serde(rename = "oauth")]
    OAuth(JiraOAuthConfig),
    #[serde(rename = "cloud")]
    Cloud(JiraCloudConfig),
    #[serde(rename = "server")]
    Server(JiraServerConfig),
}

impl JiraConfig {
    pub fn project_key(&self) -> &str {
        match self {
            Self::OAuth(c) => &c.project_key,
            Self::Cloud(c) => &c.project_key,
            Self::Server(c) => &c.project_key,
        }
    }

    pub fn issue_type(&self) -> &str {
        match self {
            Self::OAuth(c) => c.issue_type.as_deref().unwrap_or("Bug"),
            Self::Cloud(c) => c.issue_type.as_deref().unwrap_or("Bug"),
            Self::Server(c) => c.issue_type.as_deref().unwrap_or("Bug"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraOAuthConfig {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix epoch seconds when access_token expires.
    pub expires_at: i64,
    /// Cloud id returned by /oauth/token/accessible-resources.
    pub cloud_id: String,
    /// Workspace URL (e.g. https://mycompany.atlassian.net).
    pub site_url: String,
    /// Required: which Jira project to write issues to.
    pub project_key: String,
    #[serde(default)]
    pub issue_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCloudConfig {
    /// Email associated with the API token. Required.
    pub email: String,
    /// API token (https://id.atlassian.com/manage-profile/security/api-tokens).
    pub api_token: String,
    /// e.g. `mycompany.atlassian.net`. Required.
    pub site: String,
    /// Jira project key (e.g. "ENG"). Required.
    pub project_key: String,
    /// Default issue type. Defaults to "Bug" when missing.
    #[serde(default)]
    pub issue_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraServerConfig {
    /// Personal Access Token (Bearer auth). Required.
    pub access_token: String,
    /// e.g. `https://jira.mycompany.com`. Required.
    pub base_url: String,
    /// Jira project key (e.g. "ENG"). Required.
    pub project_key: String,
    /// Default issue type. Defaults to "Bug" when missing.
    #[serde(default)]
    pub issue_type: Option<String>,
}

pub struct JiraAdapter {
    pub webhook_secret: Option<String>,
    /// v1.4 W20 — Atlassian OAuth 3LO credentials. When present, the
    /// adapter's connect_mode is OAuth and operators can use the
    /// "Cloud (OAuth)" mode on the dashboard. When absent, only
    /// manual config (API token or Server PAT) is available.
    pub oauth_client_id: Option<String>,
    pub oauth_client_secret: Option<String>,
}

impl JiraAdapter {
    pub fn from_env() -> Option<Self> {
        let webhook_secret = std::env::var("SENTORI_JIRA_WEBHOOK_SECRET")
            .ok()
            .filter(|s| !s.is_empty());
        let oauth_client_id = std::env::var("SENTORI_JIRA_CLIENT_ID")
            .ok()
            .filter(|s| !s.is_empty());
        let oauth_client_secret = std::env::var("SENTORI_JIRA_CLIENT_SECRET")
            .ok()
            .filter(|s| !s.is_empty());
        Some(Self {
            webhook_secret,
            oauth_client_id,
            oauth_client_secret,
        })
    }

    pub fn verify_webhook_secret(&self, provided: &str) -> bool {
        let Some(secret) = self.webhook_secret.as_deref() else {
            return false;
        };
        constant_time_eq(secret.as_bytes(), provided.as_bytes())
    }

    fn oauth_configured(&self) -> bool {
        self.oauth_client_id.is_some() && self.oauth_client_secret.is_some()
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

fn base_url(cfg: &JiraConfig) -> String {
    match cfg {
        JiraConfig::OAuth(c) => format!(
            "https://api.atlassian.com/ex/jira/{}",
            c.cloud_id.trim_end_matches('/')
        ),
        JiraConfig::Cloud(c) => format!("https://{}", c.site.trim_end_matches('/')),
        JiraConfig::Server(c) => c.base_url.trim_end_matches('/').to_string(),
    }
}

/// Apply the right auth header for the configured deployment.
fn apply_auth(req: reqwest::RequestBuilder, cfg: &JiraConfig) -> reqwest::RequestBuilder {
    match cfg {
        JiraConfig::OAuth(c) => req.bearer_auth(&c.access_token),
        JiraConfig::Cloud(c) => req.basic_auth(&c.email, Some(&c.api_token)),
        JiraConfig::Server(c) => req.bearer_auth(&c.access_token),
    }
}

#[async_trait]
impl IntegrationAdapter for JiraAdapter {
    fn kind(&self) -> &'static str {
        "jira"
    }

    fn is_configured(&self) -> bool {
        // Always returns true so the dashboard can offer the manual
        // modes (Cloud-API-token + Server-PAT) even without OAuth
        // env vars. The OAuth flow itself gates on oauth_configured()
        // — operators picking "Cloud (OAuth)" without those env vars
        // get a clear error.
        true
    }

    fn connect_mode(&self) -> super::ConnectMode {
        if self.oauth_configured() {
            super::ConnectMode::OAuth
        } else {
            super::ConnectMode::Manual
        }
    }

    fn oauth_authorise_url(&self, state: &str, redirect_uri: &str) -> String {
        let client_id = self.oauth_client_id.clone().unwrap_or_default();
        // Scopes that match the API calls v1.3 + v1.4 make:
        //   read:jira-user      — needed for transitions list
        //   read:jira-work      — list issues / transitions
        //   write:jira-work     — create + transition issues + add comments
        //   offline_access      — refresh tokens (otherwise tokens are 1h-only)
        let scope =
            "read:jira-user read:jira-work write:jira-work offline_access";
        format!(
            "https://auth.atlassian.com/authorize?\
             audience=api.atlassian.com&client_id={cid}&scope={scope}\
             &redirect_uri={redir}&state={state}&response_type=code&prompt=consent",
            cid = urlencoding::encode(&client_id),
            scope = urlencoding::encode(scope),
            redir = urlencoding::encode(redirect_uri),
            state = urlencoding::encode(state),
        )
    }

    async fn exchange_code(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<serde_json::Value, IntegrationError> {
        let client_id = self
            .oauth_client_id
            .as_deref()
            .ok_or_else(|| IntegrationError::NotConfigured)?;
        let client_secret = self
            .oauth_client_secret
            .as_deref()
            .ok_or_else(|| IntegrationError::NotConfigured)?;
        let client = reqwest::Client::new();
        let resp = client
            .post("https://auth.atlassian.com/oauth/token")
            .json(&serde_json::json!({
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            }))
            .send()
            .await
            .map_err(|e| IntegrationError::OAuth(format!("token req: {e}")))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::OAuth(format!(
                "atlassian token exchange {}",
                resp.status()
            )));
        }
        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
            refresh_token: String,
            expires_in: i64,
        }
        let tok: TokenResp = resp
            .json()
            .await
            .map_err(|e| IntegrationError::OAuth(format!("decode token: {e}")))?;
        // Discover the workspace (cloud_id + site_url) — Atlassian
        // tenants may grant access to multiple sites; we take the
        // first for v1.4.
        let resources_resp = client
            .get("https://api.atlassian.com/oauth/token/accessible-resources")
            .bearer_auth(&tok.access_token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| IntegrationError::OAuth(format!("resources req: {e}")))?;
        if !resources_resp.status().is_success() {
            return Err(IntegrationError::OAuth(format!(
                "accessible-resources {}",
                resources_resp.status()
            )));
        }
        let resources: serde_json::Value = resources_resp
            .json()
            .await
            .map_err(|e| IntegrationError::OAuth(format!("decode resources: {e}")))?;
        let first = resources
            .as_array()
            .and_then(|arr| arr.first())
            .ok_or_else(|| {
                IntegrationError::OAuth("no accessible Atlassian site for this token".into())
            })?;
        let cloud_id = first
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| IntegrationError::OAuth("missing cloud_id".into()))?
            .to_string();
        let site_url = first
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| IntegrationError::OAuth("missing site_url".into()))?
            .to_string();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        // project_key + issue_type are operator-chosen — we can't
        // know them at OAuth time. Persist with empty defaults so
        // the dashboard can prompt for them as a follow-up form.
        let cfg = JiraOAuthConfig {
            access_token: tok.access_token,
            refresh_token: tok.refresh_token,
            expires_at: now + tok.expires_in,
            cloud_id,
            site_url,
            project_key: String::new(),
            issue_type: None,
        };
        Ok(serde_json::json!({
            "deployment": "oauth",
            "accessToken": cfg.access_token,
            "refreshToken": cfg.refresh_token,
            "expiresAt": cfg.expires_at,
            "cloudId": cfg.cloud_id,
            "siteUrl": cfg.site_url,
            "projectKey": cfg.project_key,
            "issueType": cfg.issue_type,
        }))
    }

    async fn accept_manual_config(
        &self,
        form: serde_json::Value,
    ) -> Result<serde_json::Value, IntegrationError> {
        let cfg: JiraConfig = serde_json::from_value(form)
            .map_err(|e| IntegrationError::Upstream(format!("bad jira config: {e}")))?;
        match &cfg {
            JiraConfig::OAuth(c) => {
                // OAuth config gets created via the callback flow; if
                // someone POSTs it through configure, just validate
                // the operator-supplied fields (project_key etc.) so
                // they can refine after the redirect.
                if c.project_key.is_empty() {
                    return Err(IntegrationError::Upstream("projectKey is required".into()));
                }
            }
            JiraConfig::Cloud(c) => {
                if c.email.is_empty() || c.api_token.is_empty() {
                    return Err(IntegrationError::Upstream(
                        "email + apiToken are both required (Jira Cloud)".into(),
                    ));
                }
                if c.site.is_empty() {
                    return Err(IntegrationError::Upstream("site is required".into()));
                }
                if c.project_key.is_empty() {
                    return Err(IntegrationError::Upstream("projectKey is required".into()));
                }
            }
            JiraConfig::Server(c) => {
                if c.access_token.is_empty() {
                    return Err(IntegrationError::Upstream(
                        "accessToken (PAT) is required (Jira Server)".into(),
                    ));
                }
                if c.base_url.is_empty() {
                    return Err(IntegrationError::Upstream("baseUrl is required".into()));
                }
                if !c.base_url.starts_with("http") {
                    return Err(IntegrationError::Upstream(
                        "baseUrl must start with http:// or https://".into(),
                    ));
                }
                if c.project_key.is_empty() {
                    return Err(IntegrationError::Upstream("projectKey is required".into()));
                }
            }
        }
        Ok(serde_json::to_value(&cfg).map_err(|e| IntegrationError::Upstream(e.to_string()))?)
    }

    async fn create_issue(
        &self,
        config: &serde_json::Value,
        ctx: &IssueContext,
    ) -> Result<ExternalRef, IntegrationError> {
        let cfg: JiraConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("config: {e}")))?;
        // Cloud uses /rest/api/3/issue with ADF description; Server is
        // v2 (no v3 endpoint) with plain-text description.
        let api_version = match &cfg {
            // OAuth uses the Cloud API surface (v3 ADF) but with a
            // different base URL (api.atlassian.com/ex/jira/{cloud_id}).
            JiraConfig::OAuth(_) | JiraConfig::Cloud(_) => 3,
            JiraConfig::Server(_) => 2,
        };
        let url = format!("{}/rest/api/{}/issue", base_url(&cfg), api_version);
        let description_text = format!(
            "Sentori issue {}\n{}\n\nRelease: {} · env: {} · events: {}",
            ctx.issue_id, ctx.url, ctx.release, ctx.environment, ctx.event_count,
        );
        let description = match &cfg {
            JiraConfig::OAuth(_) | JiraConfig::Cloud(_) => json!({
                "type": "doc",
                "version": 1,
                "content": [{
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "text": description_text,
                    }]
                }]
            }),
            JiraConfig::Server(_) => json!(description_text),
        };
        let body = json!({
            "fields": {
                "project": { "key": cfg.project_key() },
                "summary": format!("{}: {}", ctx.error_type, ctx.error_message),
                "issuetype": { "name": cfg.issue_type() },
                "description": description,
            }
        });
        let req = reqwest::Client::new()
            .post(&url)
            .header("Accept", "application/json")
            .header("User-Agent", "sentori-integration")
            .json(&body);
        let resp = apply_auth(req, &cfg)
            .send()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "jira create issue {}",
                resp.status()
            )));
        }
        let parsed: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        let key = parsed
            .get("key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| IntegrationError::Upstream("missing key".into()))?
            .to_string();
        let html_url = format!("{}/browse/{}", base_url(&cfg), key);
        Ok(ExternalRef {
            external_id: key,
            external_url: html_url,
        })
    }

    async fn update_status(
        &self,
        config: &serde_json::Value,
        external_id: &str,
        event: IssueLifecycleEvent,
    ) -> Result<(), IntegrationError> {
        let cfg: JiraConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("config: {e}")))?;
        let api_version = match &cfg {
            // OAuth uses the Cloud API surface (v3 ADF) but with a
            // different base URL (api.atlassian.com/ex/jira/{cloud_id}).
            JiraConfig::OAuth(_) | JiraConfig::Cloud(_) => 3,
            JiraConfig::Server(_) => 2,
        };
        let target = match event {
            IssueLifecycleEvent::Resolved => "Done",
            IssueLifecycleEvent::Regressed => "In Progress",
            IssueLifecycleEvent::Created => return Ok(()),
        };

        // Resolve transition id by name. Workflows are project-specific
        // so we must list available transitions first.
        let transitions_url = format!(
            "{}/rest/api/{}/issue/{}/transitions",
            base_url(&cfg),
            api_version,
            external_id
        );
        let client = reqwest::Client::new();
        let list_resp = apply_auth(
            client.get(&transitions_url).header("Accept", "application/json"),
            &cfg,
        )
        .send()
        .await
        .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        if !list_resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "jira transitions list {}",
                list_resp.status()
            )));
        }
        let transitions: serde_json::Value = list_resp
            .json()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        let id = transitions
            .get("transitions")
            .and_then(|v| v.as_array())
            .and_then(|arr| {
                arr.iter().find(|t| {
                    t.get("name")
                        .and_then(|n| n.as_str())
                        .map(|s| s.eq_ignore_ascii_case(target))
                        .unwrap_or(false)
                })
            })
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let Some(id) = id else {
            tracing::warn!(
                key = %external_id,
                target = %target,
                "jira: no transition with that name; configure the workflow or rename"
            );
            return Ok(());
        };

        let resp = apply_auth(
            client
                .post(&transitions_url)
                .header("Accept", "application/json")
                .header("User-Agent", "sentori-integration")
                .json(&json!({ "transition": { "id": id } })),
            &cfg,
        )
        .send()
        .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "jira transition {}",
                resp.status()
            )));
        }
        Ok(())
    }
}
