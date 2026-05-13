// Phase 43 sub-A — typed external-integration framework.
//
// Each integration is one adapter implementing `IntegrationAdapter`.
// The HTTP layer (`api::integrations`) is generic over the trait so
// adding Slack / GitHub PR / Discord later is "drop in another
// adapter + add a kind enum row to migration 0033".
//
// Adapter responsibilities:
//   - **OAuth handshake** — receive auth code, exchange for token,
//     persist into `integrations.config` JSONB. The state-token
//     bookkeeping for CSRF protection lives in the api layer
//     (Valkey-backed); adapters never touch state directly.
//   - **Issue lifecycle hooks** — `create_issue` when Sentori sees a
//     new issue worth opening upstream, `update_status` when our
//     side transitions to resolved / regressed.
//   - **Webhook ingest** — adapters expose a webhook signature
//     verifier so the api layer can route `POST /v1/integrations/
//     <kind>/webhook` to the right adapter for Linear-close →
//     Sentori-resolve type loops.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod dispatch;
pub mod linear;
pub mod slack;

#[derive(Debug, thiserror::Error)]
pub enum IntegrationError {
    /// Adapter / `kind` not recognised, or required env vars unset.
    #[error("integration not configured")]
    NotConfigured,
    /// OAuth handshake failed (bad code, expired state, …).
    #[error("oauth: {0}")]
    OAuth(String),
    /// Upstream API rejected us (4xx / 5xx, malformed response, …).
    #[error("upstream: {0}")]
    Upstream(String),
    /// Issue not linked to this kind of integration (update path).
    #[error("not linked")]
    NotLinked,
}

/// Per-issue context handed to `create_issue` / `update_status`. Keep
/// it adapter-agnostic so individual adapters can map fields to their
/// own surface (Linear has `title`/`description`; Slack uses Block
/// Kit; GitHub PR can comment vs file issue).
#[derive(Debug, Clone, Serialize)]
pub struct IssueContext {
    pub issue_id: Uuid,
    pub project_id: Uuid,
    pub error_type: String,
    pub error_message: String,
    pub release: String,
    pub environment: String,
    pub url: String,
    pub event_count: i64,
    /// Top in-app frame's `file:line`, if known.
    pub crash_site: Option<String>,
}

/// Returned by `create_issue` — what to store in
/// `issue_integration_links` so future status updates know which
/// upstream item to PATCH.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalRef {
    pub external_id: String,
    pub external_url: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IssueLifecycleEvent {
    /// New Sentori issue → adapter creates upstream item.
    Created,
    /// Sentori issue regressed → adapter re-opens upstream item.
    Regressed,
    /// Sentori issue resolved → adapter closes / comments upstream.
    Resolved,
}

/// How a user goes from "not connected" → "connected" for a given
/// adapter. OAuth (Linear) launches a redirect; Manual (Slack
/// incoming webhook) takes a JSON form submission.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectMode {
    OAuth,
    Manual,
}

#[async_trait]
pub trait IntegrationAdapter: Send + Sync {
    /// Lowercase kind ("linear", "slack", …). Used as the
    /// `integrations.kind` column value + URL path segment.
    fn kind(&self) -> &'static str;

    /// Adapter is shipping with credentials configured (env vars set,
    /// feature flag on). When false, `connect` / `callback` /
    /// `create_issue` all return `NotConfigured`.
    fn is_configured(&self) -> bool;

    /// Phase 43 sub-E: how this adapter wants to be connected.
    /// Default `OAuth` matches the historic Linear path; Slack
    /// overrides to `Manual` because incoming-webhook URLs aren't an
    /// OAuth flow.
    fn connect_mode(&self) -> ConnectMode {
        ConnectMode::OAuth
    }

    /// Build the OAuth authorise URL the user should visit. `state`
    /// is the CSRF token the api layer already minted + stored.
    /// Adapters with `connect_mode() == Manual` may return an empty
    /// string — the dispatcher routes around them.
    fn oauth_authorise_url(&self, state: &str, redirect_uri: &str) -> String;

    /// Exchange an OAuth `code` for an access token + whatever else
    /// goes in the row's `config` JSONB. The api layer persists the
    /// returned value as-is.
    async fn exchange_code(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<serde_json::Value, IntegrationError>;

    /// Phase 43 sub-E.02 — manual config path: take whatever JSON
    /// the dashboard form submits, validate, return what goes in
    /// `integrations.config`. Default impl errors so OAuth-only
    /// adapters don't accidentally pretend to support this.
    async fn accept_manual_config(
        &self,
        _form: serde_json::Value,
    ) -> Result<serde_json::Value, IntegrationError> {
        Err(IntegrationError::Upstream(
            "this adapter doesn't support manual config".into(),
        ))
    }

    /// Create the upstream item for a Sentori issue and return the
    /// (id, url) the dashboard can store + render as a back-link.
    async fn create_issue(
        &self,
        config: &serde_json::Value,
        ctx: &IssueContext,
    ) -> Result<ExternalRef, IntegrationError>;

    /// Update the upstream item when the Sentori issue transitions
    /// state. Adapter decides what "resolved" maps to upstream
    /// (Linear: close + comment; Slack: thread reply).
    async fn update_status(
        &self,
        config: &serde_json::Value,
        external_id: &str,
        event: IssueLifecycleEvent,
    ) -> Result<(), IntegrationError>;
}
