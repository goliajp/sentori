//! POST `/v1/push/tokens` — register device for push.
//!
//! UPSERT into `push_tokens` via push-provider's
//! `DeviceTokenStore::upsert`. Idempotent on (project_id, kind,
//! native_token).

use std::sync::Arc;

use axum::{Extension, Json, extract::State, http::StatusCode};
use sentori_ingest_token::IngestContext;
use sentori_push_provider::ProviderKind;
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
    /// The device's user, as the salted hash every event already
    /// carries (`events.user_key`). One identity, so "notify the
    /// people who hit this issue" is a join rather than a guess.
    /// Absent when the app registers before calling
    /// `sentori.user()` — such a device still receives broadcasts,
    /// it just is not addressable by issue.
    #[serde(default)]
    pub user_key: Option<String>,
    /// Host-supplied facts about the device — app version, locale,
    /// build channel. Shown on the device row in Settings ▸ Push so
    /// an integrator can confirm what they sent without asking us.
    ///
    /// `device_tokens.metadata` has existed since the table was
    /// created and nothing ever wrote to it: the SDK advertised the
    /// option, never sent it, and this struct had no field to receive
    /// it. Every row read `'{}'`.
    #[serde(default)]
    pub metadata: Option<Value>,
}

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> (StatusCode, Json<Value>) {
    let Some(kind) = parse_kind(&body.kind) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid_kind", "got": body.kind })),
        );
    };

    // v0.2 canonical store is `device_tokens` (push.send /
    // subscribe_topic / preferences all query it). UPSERT here +
    // RETURNING id so client gets the actual device_tokens.id back.
    let new_id = uuid::Uuid::now_v7();
    let row = sqlx::query(
        // Five columns, five placeholders. It said `$6` for a year:
        // Postgres refuses the statement outright, so every device
        // registration this SDK has ever attempted came back 500 and
        // the product had zero push tokens for a reason that was
        // never "nobody turned it on".
        "INSERT INTO device_tokens \
         (id, project_id, provider, env, native_token, user_key, metadata) \
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, '{}'::jsonb)) \
         ON CONFLICT (project_id, provider, native_token) DO UPDATE SET \
            env = COALESCE(EXCLUDED.env, device_tokens.env), \
            user_key = COALESCE(EXCLUDED.user_key, device_tokens.user_key), \
            metadata = CASE WHEN EXCLUDED.metadata = '{}'::jsonb \
                            THEN device_tokens.metadata ELSE EXCLUDED.metadata END, \
            revoked_at = NULL, \
            last_seen_at = now(), \
            updated_at = now() \
         RETURNING id, (xmax = 0) AS is_new",
    )
    .bind(new_id)
    .bind(ctx.project_id)
    .bind(&body.kind)
    .bind(body.env.as_deref())
    .bind(&body.native_token)
    .bind(body.user_key.as_deref())
    // A re-register that omits metadata keeps what is already there
    // rather than blanking it — the same shape as `env` and
    // `user_key` above, so calling `register()` on every launch never
    // loses what an earlier launch reported.
    .bind(body.metadata.as_ref())
    .fetch_one(&state.pool)
    .await;

    // Also UPSERT into the push-provider crate's push_tokens for
    // the legacy dispatcher path. Not load-bearing for v0.2; ignore.
    let _ = state
        .push_tokens
        .upsert(
            ctx.project_id,
            kind,
            &body.native_token,
            body.env.as_deref(),
            // The legacy store's `app_user_id` gets the same value:
            // two tables, one identity, rather than a second concept
            // to keep in sync.
            body.user_key.as_deref(),
        )
        .await;

    match row {
        Ok(row) => {
            use sqlx::Row;
            let device_id: uuid::Uuid = row.get("id");
            let is_new: bool = row.try_get("is_new").unwrap_or(true);
            info!(
                project_id = %ctx.project_id,
                token_id = %device_id,
                is_new,
                "push.register_token upserted",
            );
            (
                StatusCode::ACCEPTED,
                Json(json!({
                    "token_id": device_id.to_string(),
                    "is_new": is_new,
                })),
            )
        }
        Err(e) => {
            warn!(error = %e, "push.register_token db_error");
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
