// Phase 43 sub-A.03 — OAuth handshake + integration list endpoints.
//
// Routes registered under the admin protected subtree:
//
//   GET  /admin/api/integrations
//        list integrations the caller can see (one row per active
//        connection across their orgs)
//   GET  /admin/api/integrations/<kind>/connect?orgSlug=<slug>
//        mint a CSRF state, store in Valkey 10 min, 302 to the
//        adapter's OAuth authorise URL
//   GET  /admin/api/integrations/<kind>/callback?code=&state=
//        validate state, call adapter.exchange_code(), upsert row
//        into `integrations`, 302 back to the dashboard
//   DELETE /admin/api/integrations/<kind>?orgSlug=<slug>
//        soft-revoke: set `revoked_at = now()` so we can reconnect
//        cleanly and audit history is kept
//
// CSRF state: 32-hex chars, key `oauth_state:<kind>:<state>` →
// `{ orgId, callerId }` JSON; TTL 600s. Reading consumes (DEL).

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use rand::Rng;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::integrations::{
    github::GithubAdapter, gitlab::GitlabAdapter, jira::JiraAdapter, linear::LinearAdapter,
    slack::SlackAdapter, ConnectMode, IntegrationAdapter, IntegrationError,
};
use crate::recent::AppState;

const STATE_TTL_SECS: i64 = 600;
const STATE_KEY_PREFIX: &str = "oauth_state";

// ────────────────────────────── adapters ─────────────────────────────

/// Bag of every adapter the server knows about. Returns `None` when
/// the kind isn't recognised — adapter-itself-disabled (no env vars)
/// is signalled via `adapter.is_configured()`.
pub fn adapter_for(kind: &str) -> Option<Arc<dyn IntegrationAdapter>> {
    match kind {
        "linear" => LinearAdapter::from_env().map(|a| Arc::new(a) as Arc<dyn IntegrationAdapter>),
        "slack" => Some(Arc::new(SlackAdapter::new()) as Arc<dyn IntegrationAdapter>),
        "github" => GithubAdapter::from_env().map(|a| Arc::new(a) as Arc<dyn IntegrationAdapter>),
        "gitlab" => GitlabAdapter::from_env().map(|a| Arc::new(a) as Arc<dyn IntegrationAdapter>),
        "jira" => JiraAdapter::from_env().map(|a| Arc::new(a) as Arc<dyn IntegrationAdapter>),
        _ => None,
    }
}

fn redirect_uri_for(state: &AppState, kind: &str) -> String {
    format!(
        "{base}/admin/api/integrations/{kind}/callback",
        base = state.base_url.trim_end_matches('/'),
    )
}

// ────────────────────────────── list ─────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub org_slug: String,
    pub kind: String,
    /// Summary surface for the dashboard — workspace name / team
    /// label, no secrets. Adapters pluck a handful of fields out
    /// of `config` for display.
    pub display: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub async fn list_integrations(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<Vec<IntegrationRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let rows: Vec<(Uuid, Uuid, String, String, serde_json::Value, OffsetDateTime)> = match caller {
        AdminCaller::User { id, .. } => sqlx::query_as(
            "SELECT i.id, i.org_id, o.slug, i.kind, i.config, i.created_at \
             FROM integrations i \
             JOIN orgs o ON o.id = i.org_id \
             JOIN memberships m ON m.org_id = i.org_id \
             WHERE m.user_id = $1 AND i.revoked_at IS NULL \
             ORDER BY i.created_at DESC",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list_integrations: {e}")))?,
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => sqlx::query_as(
            "SELECT i.id, i.org_id, o.slug, i.kind, i.config, i.created_at \
             FROM integrations i \
             JOIN orgs o ON o.id = i.org_id \
             WHERE i.revoked_at IS NULL \
             ORDER BY i.created_at DESC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list_integrations: {e}")))?,
    };

    let out: Vec<IntegrationRow> = rows
        .into_iter()
        .map(|(id, org_id, org_slug, kind, config, created_at)| IntegrationRow {
            id,
            org_id,
            org_slug,
            display: redact_display(&kind, &config),
            kind,
            created_at,
        })
        .collect();
    Ok(Json(out))
}

/// Pluck non-secret summary fields out of `config` for dashboard
/// display. Anything not on the allowlist is dropped.
fn redact_display(kind: &str, config: &serde_json::Value) -> serde_json::Value {
    // Never echo back webhook URLs / access tokens / secrets.
    match kind {
        "linear" => json!({
            "workspaceName": config.get("workspaceName"),
            "defaultTeamName": config.get("defaultTeamName"),
        }),
        "slack" => json!({
            "channelLabel": config.get("channelLabel"),
        }),
        // v1.3 W11 — surface the "where do I write to" hint without
        // ever echoing the access token.
        "github" => json!({
            "defaultRepo": config.get("defaultRepo"),
        }),
        "gitlab" => json!({
            "projectId": config.get("projectId"),
            "baseUrl": config.get("baseUrl"),
        }),
        "jira" => json!({
            "site": config.get("site"),
            "projectKey": config.get("projectKey"),
            "issueType": config.get("issueType"),
        }),
        _ => json!({}),
    }
}

// ────────────────────────────── manual configure ────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureBody {
    pub org_slug: String,
    #[serde(flatten)]
    pub form: serde_json::Value,
}

/// `POST /admin/api/integrations/{kind}/configure` — for adapters
/// whose `connect_mode == Manual` (Slack incoming webhook today).
/// Body is `{ orgSlug, ...adapter-specific fields }`; adapter
/// validates + returns the JSON to persist into `integrations.config`.
pub async fn configure(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(kind): Path<String>,
    Json(body): Json<ConfigureBody>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    // v1.4 W20: drop the connect_mode gate. Some adapters (Jira)
    // accept BOTH OAuth (connect endpoint) and manual config — the
    // adapter's accept_manual_config decides at runtime. Adapters
    // that genuinely don't support manual config return an error
    // from the trait's default accept_manual_config impl.
    //
    // We also drop the is_configured gate here: that flag exists for
    // OAuth env-var presence, which isn't required for manual config
    // paths (e.g. operator pasting a PAT).
    let adapter = match adapter_for(&kind) {
        Some(a) => a,
        None => return Ok(not_found_response()),
    };

    let org = resolve_org(pool, &body.org_slug, &caller).await?;
    let Some((org_id, role)) = org else {
        return Ok(not_found_response());
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return Ok(forbidden_response());
    }

    let cfg = match adapter.accept_manual_config(body.form).await {
        Ok(c) => c,
        Err(e) => {
            return Ok((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalidConfig", "detail": e.to_string() })),
            )
                .into_response());
        }
    };

    upsert_integration(pool, org_id, &kind, &cfg)
        .await
        .map_err(|e| AppError::Internal(format!("upsert integration: {e}")))?;

    crate::audit::record(
        pool,
        org_id,
        None,
        "integration.connected",
        crate::audit::targets::ORG,
        Some(org_id),
        json!({ "kind": kind, "mode": "manual" }),
    )
    .await;

    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

// ────────────────────────────── connect ──────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectQuery {
    pub org_slug: String,
}

pub async fn connect(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(kind): Path<String>,
    Query(q): Query<ConnectQuery>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let valkey = state.valkey.clone().ok_or_else(|| {
        AppError::Internal("integrations require valkey for OAuth state".into())
    })?;

    let adapter = match adapter_for(&kind) {
        Some(a) if a.is_configured() => a,
        Some(_) => return Ok(disabled_response(&kind, "not configured (set SENTORI_LINEAR_CLIENT_ID + _SECRET)")),
        None => return Ok(not_found_response()),
    };

    // Phase 43 sub-E: adapters using manual config (Slack) don't
    // have an OAuth URL to redirect to. Tell the caller to POST
    // /configure instead.
    if adapter.connect_mode() == ConnectMode::Manual {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "useManualConfigure",
                "configureUrl": format!("/admin/api/integrations/{kind}/configure"),
            })),
        )
            .into_response());
    }

    let org = resolve_org(pool, &q.org_slug, &caller).await?;
    let Some((org_id, role)) = org else {
        return Ok(not_found_response());
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return Ok(forbidden_response());
    }

    // Mint state, stash in Valkey for 10 minutes.
    let state_tok = random_hex(32);
    let mut conn = valkey.clone();
    let payload = json!({ "orgId": org_id, "kind": kind }).to_string();
    let _: () = conn
        .set_ex(format!("{STATE_KEY_PREFIX}:{kind}:{state_tok}"), payload, STATE_TTL_SECS as u64)
        .await
        .map_err(|e| AppError::Internal(format!("set state: {e}")))?;

    let redirect = redirect_uri_for(&state, &kind);
    let auth_url = adapter.oauth_authorise_url(&state_tok, &redirect);
    Ok(Redirect::temporary(&auth_url).into_response())
}

// ────────────────────────────── callback ─────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

pub async fn callback(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Query(q): Query<CallbackQuery>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let valkey = state.valkey.clone().ok_or_else(|| {
        AppError::Internal("integrations require valkey for OAuth state".into())
    })?;

    if let Some(err) = q.error {
        return Ok(redirect_with_error(&state, &kind, &err));
    }
    let (Some(code), Some(state_tok)) = (q.code, q.state) else {
        return Ok(redirect_with_error(&state, &kind, "missingCodeOrState"));
    };

    let mut conn = valkey.clone();
    let key = format!("{STATE_KEY_PREFIX}:{kind}:{state_tok}");
    let stored: Option<String> = conn
        .get(&key)
        .await
        .map_err(|e| AppError::Internal(format!("get state: {e}")))?;
    let Some(stored_raw) = stored else {
        return Ok(redirect_with_error(&state, &kind, "stateExpired"));
    };
    // Consume the state token — single-use.
    let _: () = conn
        .del(&key)
        .await
        .map_err(|e| AppError::Internal(format!("del state: {e}")))?;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StoredState {
        org_id: Uuid,
    }
    let StoredState { org_id } = serde_json::from_str(&stored_raw)
        .map_err(|_| AppError::Internal("malformed stored state".into()))?;

    let adapter = match adapter_for(&kind) {
        Some(a) if a.is_configured() => a,
        _ => return Ok(redirect_with_error(&state, &kind, "adapterDisabled")),
    };

    let redirect = redirect_uri_for(&state, &kind);
    let config = match adapter.exchange_code(&code, &redirect).await {
        Ok(c) => c,
        Err(IntegrationError::OAuth(e)) => {
            tracing::warn!(error = %e, "oauth exchange failed");
            return Ok(redirect_with_error(&state, &kind, "oauthExchangeFailed"));
        }
        Err(e) => {
            tracing::error!(error = %e, "integration callback failed");
            return Ok(redirect_with_error(&state, &kind, "unexpected"));
        }
    };

    upsert_integration(pool, org_id, &kind, &config)
        .await
        .map_err(|e| AppError::Internal(format!("upsert integration: {e}")))?;

    // Audit
    crate::audit::record(
        pool,
        org_id,
        None,
        "integration.connected",
        crate::audit::targets::ORG,
        Some(org_id),
        json!({ "kind": kind }),
    )
    .await;

    Ok(redirect_with_success(&state, &kind))
}

// ────────────────────────────── webhook ──────────────────────────────

/// `POST /v1/integrations/gitlab/webhook`
///
/// GitLab uses `X-Gitlab-Token` (plain shared secret, no HMAC). We
/// expect `object_kind = issue`; `object_attributes.action` may be
/// "open" / "close" / "reopen" / "update".
pub async fn gitlab_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let adapter = match GitlabAdapter::from_env() {
        Some(a) => a,
        None => return server_error("adapterDisabled"),
    };
    let provided_token = headers
        .get("x-gitlab-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !adapter.verify_webhook_token(provided_token) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "badToken" })),
        )
            .into_response();
    }
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "badJson" })),
            )
                .into_response();
        }
    };
    if payload.get("object_kind").and_then(|v| v.as_str()) != Some("issue") {
        return StatusCode::OK.into_response();
    }
    let obj = match payload.get("object_attributes") {
        Some(o) => o,
        None => return StatusCode::OK.into_response(),
    };
    let project_path = payload
        .get("project")
        .and_then(|p| p.get("path_with_namespace"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let iid = obj.get("iid").and_then(|v| v.as_u64());
    let Some(iid) = iid else {
        return StatusCode::OK.into_response();
    };
    let external_id = format!("{project_path}#{iid}");
    let title = obj.get("title").and_then(|v| v.as_str());
    let gl_state = obj.get("state").and_then(|v| v.as_str()); // "opened"|"closed"
    let action = obj.get("action").and_then(|v| v.as_str()).unwrap_or("");

    let _ = sqlx::query(
        "UPDATE issue_integration_links \
         SET external_title = COALESCE($2, external_title), \
             external_status = COALESCE($3, external_status), \
             external_updated_at = now() \
         WHERE integration_kind = 'gitlab' AND external_id = $1",
    )
    .bind(&external_id)
    .bind(title)
    .bind(gl_state)
    .execute(pool)
    .await;

    let target = match (action, gl_state.unwrap_or("")) {
        ("close", "closed") => Some("resolved"),
        ("reopen", "opened") => Some("active"),
        _ => None,
    };
    let Some(target) = target else {
        return StatusCode::OK.into_response();
    };
    let row: Option<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT i.id, i.status FROM issues i \
         JOIN issue_integration_links l ON l.issue_id = i.id \
         WHERE l.integration_kind = 'gitlab' AND l.external_id = $1",
    )
    .bind(&external_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    let Some((issue_id, current_status)) = row else {
        return StatusCode::OK.into_response();
    };
    if current_status == target {
        return StatusCode::OK.into_response();
    }
    let _ = sqlx::query(
        "UPDATE issues SET \
             status = $1, \
             resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END, \
             regressed_at = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_at END \
         WHERE id = $2",
    )
    .bind(target)
    .bind(issue_id)
    .execute(pool)
    .await;
    tracing::info!(%issue_id, %external_id, from=%current_status, to=%target, "gitlab webhook drove sentori status change");
    StatusCode::OK.into_response()
}

/// `POST /v1/integrations/jira/webhook?secret=<env>`
///
/// Jira Cloud webhooks don't sign payloads; we route on a `secret`
/// query param that the operator pastes into the Jira automation rule.
pub async fn jira_webhook(
    State(state): State<AppState>,
    Query(q): Query<JiraWebhookQuery>,
    body: Bytes,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let adapter = match JiraAdapter::from_env() {
        Some(a) => a,
        None => return server_error("adapterDisabled"),
    };
    if !adapter.verify_webhook_secret(&q.secret) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "badSecret" })),
        )
            .into_response();
    }
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "badJson" })),
            )
                .into_response();
        }
    };
    // Jira fires `jira:issue_updated` (and others).
    let event_type = payload
        .get("webhookEvent")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !event_type.starts_with("jira:issue_") {
        return StatusCode::OK.into_response();
    }
    let issue = match payload.get("issue") {
        Some(i) => i,
        None => return StatusCode::OK.into_response(),
    };
    let key = match issue.get("key").and_then(|v| v.as_str()) {
        Some(k) => k.to_string(),
        None => return StatusCode::OK.into_response(),
    };
    let fields = issue.get("fields");
    let title = fields
        .and_then(|f| f.get("summary"))
        .and_then(|v| v.as_str());
    let status_name = fields
        .and_then(|f| f.get("status"))
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str());
    let _ = sqlx::query(
        "UPDATE issue_integration_links \
         SET external_title = COALESCE($2, external_title), \
             external_status = COALESCE($3, external_status), \
             external_updated_at = now() \
         WHERE integration_kind = 'jira' AND external_id = $1",
    )
    .bind(&key)
    .bind(title)
    .bind(status_name)
    .execute(pool)
    .await;
    let target = match status_name.unwrap_or("") {
        "Done" | "Resolved" | "Closed" => Some("resolved"),
        "In Progress" | "To Do" | "Open" | "Reopened" => Some("active"),
        _ => None,
    };
    let Some(target) = target else {
        return StatusCode::OK.into_response();
    };
    let row: Option<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT i.id, i.status FROM issues i \
         JOIN issue_integration_links l ON l.issue_id = i.id \
         WHERE l.integration_kind = 'jira' AND l.external_id = $1",
    )
    .bind(&key)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    let Some((issue_id, current_status)) = row else {
        return StatusCode::OK.into_response();
    };
    if current_status == target {
        return StatusCode::OK.into_response();
    }
    let _ = sqlx::query(
        "UPDATE issues SET \
             status = $1, \
             resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END, \
             regressed_at = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_at END \
         WHERE id = $2",
    )
    .bind(target)
    .bind(issue_id)
    .execute(pool)
    .await;
    tracing::info!(%issue_id, %key, from=%current_status, to=%target, "jira webhook drove sentori status change");
    StatusCode::OK.into_response()
}

#[derive(Debug, Deserialize)]
pub struct JiraWebhookQuery {
    pub secret: String,
}

/// `POST /v1/integrations/github/webhook`
///
/// GitHub posts here on `issues` events with `X-Hub-Signature-256:
/// sha256=<hex>` header. We refresh the link row's title + state, and
/// for closed/reopened actions also drive sentori-side status sync.
pub async fn github_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let adapter = match GithubAdapter::from_env() {
        Some(a) => a,
        None => return server_error("adapterDisabled"),
    };
    let sig = headers
        .get("x-hub-signature-256")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !adapter.verify_webhook_signature(&body, sig) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "badSignature" })),
        )
            .into_response();
    }
    let event_type = headers
        .get("x-github-event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if event_type != "issues" {
        return StatusCode::OK.into_response();
    }
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "badJson" })),
            )
                .into_response();
        }
    };
    let action = payload.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let issue = match payload.get("issue") {
        Some(i) => i,
        None => return StatusCode::OK.into_response(),
    };
    let number = match issue.get("number").and_then(|v| v.as_u64()) {
        Some(n) => n,
        None => return StatusCode::OK.into_response(),
    };
    let repo_full_name = payload
        .get("repository")
        .and_then(|r| r.get("full_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if repo_full_name.is_empty() {
        return StatusCode::OK.into_response();
    }
    let external_id = format!("{repo_full_name}#{number}");
    let title = issue.get("title").and_then(|v| v.as_str());
    let gh_state = issue.get("state").and_then(|v| v.as_str()); // "open"|"closed"

    let _ = sqlx::query(
        "UPDATE issue_integration_links \
         SET external_title = COALESCE($2, external_title), \
             external_status = COALESCE($3, external_status), \
             external_updated_at = now() \
         WHERE integration_kind = 'github' AND external_id = $1",
    )
    .bind(&external_id)
    .bind(title)
    .bind(gh_state)
    .execute(pool)
    .await;

    // Action-driven sentori-side sync.
    let target_status = match (action, gh_state.unwrap_or("")) {
        ("closed", "closed") => Some("resolved"),
        ("reopened", "open") => Some("active"),
        _ => None,
    };
    let Some(target) = target_status else {
        return StatusCode::OK.into_response();
    };
    let row: Option<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT i.id, i.status FROM issues i \
         JOIN issue_integration_links l ON l.issue_id = i.id \
         WHERE l.integration_kind = 'github' AND l.external_id = $1",
    )
    .bind(&external_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    let Some((issue_id, current_status)) = row else {
        return StatusCode::OK.into_response();
    };
    if current_status == target {
        return StatusCode::OK.into_response();
    }
    let _ = sqlx::query(
        "UPDATE issues SET \
             status = $1, \
             resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END, \
             regressed_at = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_at END \
         WHERE id = $2",
    )
    .bind(target)
    .bind(issue_id)
    .execute(pool)
    .await;
    tracing::info!(%issue_id, %external_id, from=%current_status, to=%target, "github webhook drove sentori status change");
    StatusCode::OK.into_response()
}

/// `POST /v1/integrations/linear/webhook`
///
/// Linear posts here on any Issue / Comment / Project change with a
/// JSON payload + `Linear-Signature` header (hex HMAC-SHA-256 of
/// the body with the OAuth app's webhook secret).
///
/// What we honour today (sub-D scope):
///   - `type=Issue, action=update`:
///     - state.type → "completed" or "canceled"  → Sentori resolve
///     - state.type → "started" / "unstarted" / "backlog" while the
///       linked Sentori issue is `resolved`        → Sentori regression
///
/// Everything else is acked (200) but ignored — Linear retries on
/// non-2xx, and we want to silently drop comments / project events
/// without driving retries.
pub async fn linear_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let adapter = match LinearAdapter::from_env() {
        Some(a) => a,
        None => return server_error("adapterDisabled"),
    };

    // Linear uses `Linear-Signature` (hex SHA-256 HMAC).
    let sig = headers
        .get("linear-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !adapter.verify_webhook_signature(&body, sig) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "badSignature" })),
        )
            .into_response();
    }

    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "linear webhook: bad json");
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "badJson" })),
            )
                .into_response();
        }
    };

    // We only care about Issue update events for now.
    let kind = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let action = payload.get("action").and_then(|v| v.as_str()).unwrap_or("");
    if !(kind == "Issue" && action == "update") {
        return StatusCode::OK.into_response();
    }
    let data = match payload.get("data") {
        Some(d) => d,
        None => return StatusCode::OK.into_response(),
    };
    let linear_id = data.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if linear_id.is_empty() {
        return StatusCode::OK.into_response();
    }
    let state_type = data
        .get("state")
        .and_then(|s| s.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let state_name = data
        .get("state")
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let external_title = data
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    // v1.2 W7.a — refresh denormalised link metadata regardless of
    // whether the state transition is one we honour for status sync.
    // The dashboard's "Linked issues" panel reads these to render
    // "ENG-123 · In Progress" without an external round-trip.
    let _ = sqlx::query(
        "UPDATE issue_integration_links \
         SET external_title = COALESCE($2, external_title), \
             external_status = COALESCE($3, external_status), \
             external_updated_at = now() \
         WHERE integration_kind = 'linear' AND external_id = $1",
    )
    .bind(linear_id)
    .bind(external_title.as_deref())
    .bind(state_name.as_deref())
    .execute(pool)
    .await;

    // Map Linear state → Sentori status.
    let new_status = match state_type {
        "completed" | "canceled" => Some("resolved"),
        "started" | "unstarted" | "backlog" | "triage" => Some("active"),
        _ => None,
    };
    let Some(target_status) = new_status else {
        return StatusCode::OK.into_response();
    };

    // Find the linked Sentori issue. Skip silently if no link.
    let row: Option<(uuid::Uuid, String)> = sqlx::query_as(
        "SELECT i.id, i.status FROM issues i \
         JOIN issue_integration_links l ON l.issue_id = i.id \
         WHERE l.integration_kind = 'linear' AND l.external_id = $1",
    )
    .bind(linear_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    let Some((issue_id, current_status)) = row else {
        return StatusCode::OK.into_response();
    };
    if current_status == target_status {
        // No-op: stops the comment loop (sub-B posts on resolve →
        // Linear could re-fire webhook → we'd UPDATE → no change).
        return StatusCode::OK.into_response();
    }

    if let Err(e) = sqlx::query(
        "UPDATE issues SET \
             status = $1, \
             resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END, \
             regressed_at = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_at END \
         WHERE id = $2",
    )
    .bind(target_status)
    .bind(issue_id)
    .execute(pool)
    .await
    {
        tracing::error!(error = %e, %issue_id, "linear webhook: status update failed");
        return server_error("dbError");
    }

    // Audit — origin "integration:linear" so a triage user can see
    // why an issue moved without anyone clicking in dashboard.
    if let Ok(proj_id) = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT project_id FROM issues WHERE id = $1",
    )
    .bind(issue_id)
    .fetch_one(pool)
    .await
    {
        if let Ok(org_id) = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT org_id FROM projects WHERE id = $1",
        )
        .bind(proj_id)
        .fetch_one(pool)
        .await
        {
            crate::audit::record(
                pool,
                org_id,
                None,
                "issue.status.reverse_sync",
                "issue",
                Some(issue_id),
                json!({
                    "from": current_status,
                    "to": target_status,
                    "source": "linear",
                    "externalId": linear_id,
                }),
            )
            .await;
        }
    }

    tracing::info!(
        %issue_id,
        from = %current_status,
        to = %target_status,
        external = %linear_id,
        "linear webhook drove sentori status change"
    );
    StatusCode::OK.into_response()
}

// ────────────────────────────── revoke ───────────────────────────────

pub async fn revoke(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(kind): Path<String>,
    Query(q): Query<ConnectQuery>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let org = resolve_org(pool, &q.org_slug, &caller).await?;
    let Some((org_id, role)) = org else {
        return Ok(not_found_response());
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return Ok(forbidden_response());
    }
    sqlx::query(
        "UPDATE integrations SET revoked_at = now() \
         WHERE org_id = $1 AND kind = $2 AND revoked_at IS NULL",
    )
    .bind(org_id)
    .bind(&kind)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("revoke: {e}")))?;

    crate::audit::record(
        pool,
        org_id,
        None,
        "integration.revoked",
        crate::audit::targets::ORG,
        Some(org_id),
        json!({ "kind": kind }),
    )
    .await;

    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

// ────────────────────────────── helpers ──────────────────────────────

pub async fn upsert_integration(
    pool: &PgPool,
    org_id: Uuid,
    kind: &str,
    config: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    // Soft-revoke any previous active row for this (org, kind) so the
    // partial unique index doesn't block the insert.
    sqlx::query(
        "UPDATE integrations SET revoked_at = now() \
         WHERE org_id = $1 AND kind = $2 AND revoked_at IS NULL",
    )
    .bind(org_id)
    .bind(kind)
    .execute(pool)
    .await?;
    sqlx::query(
        "INSERT INTO integrations (id, org_id, kind, config) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(org_id)
    .bind(kind)
    .bind(config)
    .execute(pool)
    .await?;
    Ok(())
}

async fn resolve_org(
    pool: &PgPool,
    slug: &str,
    caller: &AdminCaller,
) -> Result<Option<(Uuid, String)>, AppError> {
    let res = match caller {
        AdminCaller::User { id, .. } => sqlx::query_as::<_, (Uuid, String)>(
            "SELECT o.id, m.role FROM orgs o \
             JOIN memberships m ON m.org_id = o.id \
             WHERE o.slug = $1 AND m.user_id = $2",
        )
        .bind(slug)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Internal(format!("resolve_org: {e}")))?,
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => sqlx::query_as::<_, (Uuid,)>(
            "SELECT id FROM orgs WHERE slug = $1",
        )
        .bind(slug)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Internal(format!("resolve_org: {e}")))?
        .map(|(id,)| (id, "owner".to_string())),
    };
    Ok(res)
}

// v2.4 — post-OAuth-callback redirects target `/main` (the SPA
// dashboard root) instead of `/integrations`. The SPA's root
// redirect lands the operator on their first org's overview;
// the `?connected=<kind>` / `?failed=<kind>` query params survive
// the redirect so the dashboard can flash a toast. (Pre-v2.4 this
// redirected to a bare `/integrations` path that didn't carry the
// org-slug context and was actually broken post the per-org
// settings move — the redirect served the marketing site after the
// single-domain consolidation, dropping the OAuth result on the floor.)
fn redirect_with_success(state: &AppState, kind: &str) -> Response {
    Redirect::temporary(&format!(
        "{base}/main?integrationConnected={kind}",
        base = state.base_url.trim_end_matches('/'),
    ))
    .into_response()
}

fn redirect_with_error(state: &AppState, kind: &str, error: &str) -> Response {
    Redirect::temporary(&format!(
        "{base}/main?integrationFailed={kind}&error={err}",
        base = state.base_url.trim_end_matches('/'),
        err = urlencoding::encode(error),
    ))
    .into_response()
}

fn disabled_response(kind: &str, reason: &str) -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "error": "integrationDisabled", "kind": kind, "reason": reason })),
    )
        .into_response()
}

fn not_found_response() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "notFound" }))).into_response()
}

fn forbidden_response() -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": "forbidden" }))).into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill(&mut buf[..]);
    hex::encode(buf)
}
