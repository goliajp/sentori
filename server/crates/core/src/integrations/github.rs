// v1.2 W7.b — GitHub Issues adapter.
//
// Auth: per-org Personal Access Token (PAT) stored in
// `integrations.config.accessToken`. Scopes needed: `repo` (private
// repos) or `public_repo` (public only). No OAuth handshake; the
// adapter uses `connect_mode = Manual` so the dashboard's
// `configure` form POSTs the token directly.
//
// Outbound:
//   Created   → POST /repos/{owner}/{repo}/issues
//   Resolved  → PATCH /repos/{owner}/{repo}/issues/{n} state=closed
//   Regressed → PATCH state=open + POST comment
//
// Inbound (handled in api/integrations.rs): `issues` event refreshes
// the link row's title + state. Signature uses HMAC-SHA-256 with
// `X-Hub-Signature-256` (lowercased `sha256=<hex>`).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{ExternalRef, IntegrationAdapter, IntegrationError, IssueContext, IssueLifecycleEvent};

const GITHUB_API_BASE: &str = "https://api.github.com";

/// Process-wide cache for GitHub App installation access tokens.
/// Token lifetime is 1 hour per the GitHub spec; we expire 5 min
/// early to avoid races on the boundary.
///
/// v1.4 W21: when Valkey is configured (init_valkey_cache called from
/// main.rs at boot), the cache writes-through to Valkey so multiple
/// Sentori instances share the install-token state and don't burn
/// install-token-exchange API calls each.
struct CachedInstallToken {
    token: String,
    expires_at: Instant,
}

static INSTALL_TOKEN_CACHE: OnceLock<Mutex<HashMap<String, CachedInstallToken>>> = OnceLock::new();

/// v1.4 W21 — Valkey connection manager used as a write-through
/// layer on top of the process-local cache. Set by main.rs at boot
/// when VALKEY_URL is configured.
static VALKEY: OnceLock<redis::aio::ConnectionManager> = OnceLock::new();

/// Wire the Valkey-backed install-token cache. Called once at boot
/// from main.rs. Idempotent: second + later calls are no-ops.
pub fn init_valkey_cache(conn: redis::aio::ConnectionManager) {
    let _ = VALKEY.set(conn);
}

fn install_token_cache() -> &'static Mutex<HashMap<String, CachedInstallToken>> {
    INSTALL_TOKEN_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn valkey_key(installation_id: &str) -> String {
    format!("gh-app-install-token:{installation_id}")
}

async fn valkey_get(installation_id: &str) -> Option<String> {
    let conn = VALKEY.get()?.clone();
    let mut conn = conn;
    let key = valkey_key(installation_id);
    use redis::AsyncCommands;
    conn.get::<_, Option<String>>(&key).await.ok().flatten()
}

async fn valkey_set(installation_id: &str, token: &str, ttl_secs: u64) {
    let Some(conn) = VALKEY.get() else { return };
    let mut conn = conn.clone();
    let key = valkey_key(installation_id);
    use redis::AsyncCommands;
    let _: Result<(), _> = conn.set_ex(&key, token, ttl_secs).await;
}

/// v1.3 W13 — adapter supports two auth modes. `pat` mirrors the
/// v1.2 W7.b shape (Personal Access Token). `app` uses a GitHub App
/// install: server signs a short-lived JWT with the App's private
/// key, exchanges it for an installation access token, then makes
/// the same REST calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "mode")]
pub enum GithubConfig {
    #[serde(rename = "pat")]
    Pat(GithubPatConfig),
    #[serde(rename = "app")]
    App(GithubAppConfig),
}

impl GithubConfig {
    pub fn default_repo(&self) -> &str {
        match self {
            Self::Pat(c) => c.default_repo.as_str(),
            Self::App(c) => c.default_repo.as_str(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubPatConfig {
    /// PAT or fine-grained token. Required.
    pub access_token: String,
    /// `owner/repo` — issues land here by default. Required.
    pub default_repo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAppConfig {
    /// GitHub App ID (numeric, but stored as string for forward-compat).
    pub app_id: String,
    /// RSA private key in PEM form, including the BEGIN/END lines.
    pub private_key: String,
    /// Numeric installation id (the App's installation on the target org).
    pub installation_id: String,
    /// `owner/repo`. Required.
    pub default_repo: String,
}

pub struct GithubAdapter {
    /// Webhook signing secret — operator pastes the same string into
    /// the GitHub webhook config. Optional: unset means we can't
    /// verify signatures, so the receiver hard-fails to keep the
    /// "unconfigured" case explicit.
    pub webhook_secret: Option<String>,
}

impl GithubAdapter {
    pub fn from_env() -> Option<Self> {
        // GitHub Issues runs entirely through per-org PAT — no app-level
        // env vars to gate the *adapter* on. We still surface a webhook
        // secret env var so the inbound webhook receiver has a known
        // secret to verify against (one secret per Sentori deployment,
        // shared across orgs that opt into the integration).
        let webhook_secret = std::env::var("SENTORI_GITHUB_WEBHOOK_SECRET")
            .ok()
            .filter(|s| !s.is_empty());
        Some(Self { webhook_secret })
    }

    pub fn verify_webhook_signature(&self, body: &[u8], signature: &str) -> bool {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let Some(secret) = self.webhook_secret.as_deref() else {
            return false;
        };
        // GitHub format: `sha256=<hex>` in X-Hub-Signature-256.
        let hex_part = match signature.strip_prefix("sha256=") {
            Some(h) => h,
            None => return false,
        };
        let Ok(mut mac) = <Hmac<Sha256> as Mac>::new_from_slice(secret.as_bytes()) else {
            return false;
        };
        mac.update(body);
        let expected = mac.finalize().into_bytes();
        let Ok(provided) = hex::decode(hex_part) else {
            return false;
        };
        constant_time_eq(expected.as_slice(), provided.as_slice())
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

#[async_trait]
impl IntegrationAdapter for GithubAdapter {
    fn kind(&self) -> &'static str {
        "github"
    }

    fn is_configured(&self) -> bool {
        // Adapter is always available; per-org auth is in the
        // integrations row's config.
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
        Err(IntegrationError::Upstream(
            "github adapter uses manual config; no OAuth code exchange".into(),
        ))
    }

    async fn accept_manual_config(
        &self,
        form: serde_json::Value,
    ) -> Result<serde_json::Value, IntegrationError> {
        let cfg: GithubConfig = serde_json::from_value(form).map_err(|e| {
            IntegrationError::Upstream(format!("bad github config: {e}"))
        })?;
        match &cfg {
            GithubConfig::Pat(c) => {
                if c.access_token.is_empty() {
                    return Err(IntegrationError::Upstream("accessToken is required".into()));
                }
                if !c.default_repo.contains('/') {
                    return Err(IntegrationError::Upstream(
                        "defaultRepo must be in 'owner/repo' form".into(),
                    ));
                }
            }
            GithubConfig::App(c) => {
                if c.app_id.is_empty() || c.private_key.is_empty() || c.installation_id.is_empty() {
                    return Err(IntegrationError::Upstream(
                        "appId, privateKey, and installationId are all required".into(),
                    ));
                }
                if !c.default_repo.contains('/') {
                    return Err(IntegrationError::Upstream(
                        "defaultRepo must be in 'owner/repo' form".into(),
                    ));
                }
                if !c.private_key.contains("BEGIN") {
                    return Err(IntegrationError::Upstream(
                        "privateKey looks malformed — paste the full PEM block".into(),
                    ));
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
        let cfg: GithubConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("config: {e}")))?;
        let bearer = resolve_bearer(&cfg).await?;
        let url = format!("{GITHUB_API_BASE}/repos/{}/issues", cfg.default_repo());
        let body = json!({
            "title": format!("{}: {}", ctx.error_type, ctx.error_message),
            "body": format!(
                "**Sentori** issue · `{}`\n\n[Open in Sentori]({})\n\n\
                 Release: `{}` · env: `{}` · events seen: {}\n\
                 {}",
                ctx.issue_id,
                ctx.url,
                ctx.release,
                ctx.environment,
                ctx.event_count,
                ctx.crash_site
                    .as_ref()
                    .map(|c| format!("Crash site: `{c}`\n"))
                    .unwrap_or_default(),
            ),
        });
        let resp = reqwest::Client::new()
            .post(&url)
            .bearer_auth(&bearer)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "sentori-integration")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&body)
            .send()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "github create issue {}",
                resp.status()
            )));
        }
        let parsed: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        let number = parsed
            .get("number")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| IntegrationError::Upstream("missing number in github response".into()))?;
        let html_url = parsed
            .get("html_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| IntegrationError::Upstream("missing html_url".into()))?
            .to_string();
        Ok(ExternalRef {
            external_id: format!("{}#{}", cfg.default_repo(), number),
            external_url: html_url,
        })
    }

    async fn update_status(
        &self,
        config: &serde_json::Value,
        external_id: &str,
        event: IssueLifecycleEvent,
    ) -> Result<(), IntegrationError> {
        let cfg: GithubConfig = serde_json::from_value(config.clone())
            .map_err(|e| IntegrationError::Upstream(format!("config: {e}")))?;
        let bearer = resolve_bearer(&cfg).await?;
        // external_id is `owner/repo#N`.
        let (repo, n) = external_id
            .split_once('#')
            .ok_or_else(|| IntegrationError::Upstream("bad external_id".into()))?;
        let url = format!("{GITHUB_API_BASE}/repos/{repo}/issues/{n}");
        let state = match event {
            IssueLifecycleEvent::Resolved => "closed",
            IssueLifecycleEvent::Regressed | IssueLifecycleEvent::Created => "open",
        };
        let client = reqwest::Client::new();
        let resp = client
            .patch(&url)
            .bearer_auth(&bearer)
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "sentori-integration")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&json!({ "state": state }))
            .send()
            .await
            .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(IntegrationError::Upstream(format!(
                "github update state {}",
                resp.status()
            )));
        }
        // For regressions, also post a comment.
        if matches!(event, IssueLifecycleEvent::Regressed) {
            let comment_url = format!("{GITHUB_API_BASE}/repos/{repo}/issues/{n}/comments");
            let _ = client
                .post(&comment_url)
                .bearer_auth(&bearer)
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "sentori-integration")
                .json(&json!({ "body": "Sentori reopened: this error regressed in a new event." }))
                .send()
                .await;
        }
        Ok(())
    }
}

/// Resolve the right bearer token to send on GitHub API calls.
/// For PAT mode it's the literal token. For App mode it's the
/// installation access token, which we mint by signing a 10-minute
/// JWT with the app's RSA key and exchanging it.
async fn resolve_bearer(cfg: &GithubConfig) -> Result<String, IntegrationError> {
    match cfg {
        GithubConfig::Pat(c) => Ok(c.access_token.clone()),
        GithubConfig::App(c) => app_installation_token(c).await,
    }
}

async fn app_installation_token(c: &GithubAppConfig) -> Result<String, IntegrationError> {
    // Cache hit (in-process): a fresh-enough token already exists.
    {
        let cache = install_token_cache().lock().unwrap();
        if let Some(entry) = cache.get(&c.installation_id) {
            if entry.expires_at > Instant::now() {
                return Ok(entry.token.clone());
            }
        }
    }
    // Cache hit (Valkey): a peer instance refreshed a token recently
    // — re-use it across the cluster.
    if let Some(token) = valkey_get(&c.installation_id).await {
        // Repopulate the local cache with a 55-min Instant deadline
        // so subsequent calls on the same process avoid the Valkey
        // round-trip too. (Valkey holds the canonical TTL.)
        let expires_at = Instant::now() + Duration::from_secs(55 * 60);
        let mut local = install_token_cache().lock().unwrap();
        if local.len() >= 1024 {
            local.clear();
        }
        local.insert(
            c.installation_id.clone(),
            CachedInstallToken {
                expires_at,
                token: token.clone(),
            },
        );
        return Ok(token);
    }

    // Build the App JWT. GitHub allows iss = appId (numeric), iat
    // up to 60s in the past (clock-skew tolerance), exp up to 10
    // minutes in the future.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs() as i64;
    let claims = json!({
        "iat": now - 60,
        "exp": now + 60 * 9,
        "iss": c.app_id,
    });
    let header = Header::new(Algorithm::RS256);
    let key = EncodingKey::from_rsa_pem(c.private_key.as_bytes())
        .map_err(|e| IntegrationError::Upstream(format!("private key parse: {e}")))?;
    let jwt = encode(&header, &claims, &key)
        .map_err(|e| IntegrationError::Upstream(format!("jwt sign: {e}")))?;

    let url = format!(
        "{GITHUB_API_BASE}/app/installations/{}/access_tokens",
        c.installation_id
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(&jwt)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "sentori-integration")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(IntegrationError::Upstream(format!(
            "github installation token exchange {}",
            resp.status()
        )));
    }
    let parsed: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| IntegrationError::Upstream(e.to_string()))?;
    let token = parsed
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| IntegrationError::Upstream("missing token in app response".into()))?
        .to_string();
    // Cache for 55 min (GitHub gives 1h; expire 5 min early).
    {
        let mut cache = install_token_cache().lock().unwrap();
        cache.insert(
            c.installation_id.clone(),
            CachedInstallToken {
                expires_at: Instant::now() + Duration::from_secs(55 * 60),
                token: token.clone(),
            },
        );
    }
    // Write-through to Valkey when available — peer instances can pick
    // it up without doing their own JWT exchange.
    valkey_set(&c.installation_id, &token, 55 * 60).await;
    Ok(token)
}
