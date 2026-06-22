//! POST `/v1/push/tokens` — register device for push.
//!
//! UPSERT into `push_tokens` via push-provider's
//! `DeviceTokenStore::upsert`. Idempotent on (project_id, kind,
//! native_token).

use std::sync::Arc;

use axum::{Extension, Json, extract::State, http::StatusCode};
use sentori_ingest_token::IngestContext;
use sentori_push_provider::{ProviderKind, PushError};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterBody {
    /// Provider: `apns` / `fcm` / `webpush` / `hcm` / `mipush`.
    pub kind: String,
    /// Provider-native token (APNs hex, FCM reg id, web sub JSON).
    pub native_token: String,
    /// Optional environment hint (`production` / `sandbox` for APNs).
    #[serde(default)]
    pub env: Option<String>,
    /// App-side user identifier for targeted dispatch.
    #[serde(default)]
    pub app_user_id: Option<String>,
}

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> (StatusCode, Json<Value>) {
    let kind = match parse_kind(&body.kind) {
        Some(k) => k,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_kind", "got": body.kind })),
            );
        }
    };

    // Double-write: push_tokens (v0.1 push-provider crate path —
    // used by the dispatcher) + device_tokens (v0.2 legacy-compat
    // path — used by topic / preference subscriptions). Same
    // (project_id, kind, native_token) is the dedup key on both.
    let device_token_id = uuid::Uuid::now_v7();
    let _ = sqlx::query(
        "INSERT INTO device_tokens \
         (id, workspace_id, project_id, provider, env, native_token) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (project_id, provider, native_token) DO UPDATE SET \
            env = COALESCE(EXCLUDED.env, device_tokens.env), \
            revoked_at = NULL, \
            last_seen_at = now(), \
            updated_at = now()",
    )
    .bind(device_token_id)
    .bind(ctx.workspace_id.into_uuid())
    .bind(ctx.project_id.into_uuid())
    .bind(&body.kind)
    .bind(body.env.as_deref())
    .bind(&body.native_token)
    .execute(&state.pool)
    .await;

    match state
        .push_tokens
        .upsert(
            ctx.project_id,
            kind,
            &body.native_token,
            body.env.as_deref(),
            body.app_user_id.as_deref(),
        )
        .await
    {
        Ok(minted) => {
            info!(
                workspace_id = %ctx.workspace_id,
                project_id = %ctx.project_id,
                token_id = %minted.id,
                is_new = minted.is_new,
                "push.register_token upserted",
            );
            (
                StatusCode::ACCEPTED,
                Json(json!({
                    "token_id": minted.id.to_string(),
                    "is_new": minted.is_new,
                })),
            )
        }
        Err(PushError::ProjectNotFound(_)) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "project_not_found" })),
        ),
        Err(PushError::InvalidInput(msg)) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid_input", "detail": msg })),
        ),
        Err(e) => {
            warn!(workspace_id = %ctx.workspace_id, error = %e, "push.register_token db_error");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}

fn parse_kind(s: &str) -> Option<ProviderKind> {
    match s {
        "apns" => Some(ProviderKind::Apns),
        "fcm" => Some(ProviderKind::Fcm),
        "webpush" => Some(ProviderKind::WebPush),
        "hcm" => Some(ProviderKind::Hcm),
        "mipush" => Some(ProviderKind::MiPush),
        _ => None,
    }
}
