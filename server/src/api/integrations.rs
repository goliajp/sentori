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
    extract::{Extension, Path, Query, State},
    http::StatusCode,
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
use crate::integrations::{linear::LinearAdapter, IntegrationAdapter, IntegrationError};
use crate::recent::AppState;

const STATE_TTL_SECS: i64 = 600;
const STATE_KEY_PREFIX: &str = "oauth_state";

// ────────────────────────────── adapters ─────────────────────────────

/// Bag of every adapter the server knows about. Returns `None` when
/// the kind isn't recognised — adapter-itself-disabled (no env vars)
/// is signalled via `adapter.is_configured()`.
fn adapter_for(kind: &str) -> Option<Arc<dyn IntegrationAdapter>> {
    match kind {
        "linear" => LinearAdapter::from_env().map(|a| Arc::new(a) as Arc<dyn IntegrationAdapter>),
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
    match kind {
        "linear" => json!({
            "workspaceName": config.get("workspaceName"),
            "defaultTeamName": config.get("defaultTeamName"),
        }),
        _ => json!({}),
    }
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

async fn upsert_integration(
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

fn redirect_with_success(state: &AppState, kind: &str) -> Response {
    Redirect::temporary(&format!(
        "{base}/integrations?connected={kind}",
        base = state.base_url.trim_end_matches('/'),
    ))
    .into_response()
}

fn redirect_with_error(state: &AppState, kind: &str, error: &str) -> Response {
    Redirect::temporary(&format!(
        "{base}/integrations?failed={kind}&error={err}",
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

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill(&mut buf[..]);
    hex::encode(buf)
}
