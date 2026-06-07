// v2.7 — device-token CRUD.
//
// Mobile / browser clients hit `POST /v1/push/tokens` with the raw
// provider token (APNs hex device token, FCM registration id, etc.);
// the server upserts a `device_tokens` row and returns an `ipt_*`
// handle that's stable across token refreshes for the same
// (project, provider, native_token) triplet.
//
// Identity link: if the SDK sends a `linkHash` (hex of the salted
// hash the customer used in v2.3 identity flow), the server resolves
// it via `identity::compute_fingerprint` and stores the 32-byte
// BYTEA in `user_fingerprint_hex`. Lets the operator later send
// push to "every device of user X" by looking up the fingerprint
// across the device_tokens index.

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::push::types::format_token_handle;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterTokenInput {
    pub provider: String,
    pub env: Option<String>,
    pub native_token: String,
    pub link_hash: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredToken {
    pub id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Error)]
pub enum TokenError {
    #[error("invalid provider: {0}")]
    InvalidProvider(String),
    #[error("native_token is empty")]
    EmptyNativeToken,
    #[error("database error")]
    Database(#[from] sqlx::Error),
}

const VALID_PROVIDERS: &[&str] = &["apns", "fcm", "webpush", "hcm", "mipush"];

/// Insert-or-refresh a device token. Stable behaviour: same
/// (project, provider, native_token) → same row id forever. The
/// `last_seen_at` + `updated_at` get bumped, `metadata` overwritten,
/// `revoked_at` cleared (a user who reinstalls + re-grants permission
/// undoes their previous revocation).
pub async fn register_token(
    pool: &PgPool,
    project_id: Uuid,
    input: RegisterTokenInput,
    user_fingerprint_hex: Option<&[u8]>,
) -> Result<RegisteredToken, TokenError> {
    if !VALID_PROVIDERS.contains(&input.provider.as_str()) {
        return Err(TokenError::InvalidProvider(input.provider));
    }
    if input.native_token.trim().is_empty() {
        return Err(TokenError::EmptyNativeToken);
    }
    let id = Uuid::now_v7();
    let row = sqlx::query_as::<_, (Uuid, OffsetDateTime, OffsetDateTime)>(
        "INSERT INTO device_tokens \
            (id, project_id, provider, env, native_token, user_fingerprint_hex, metadata) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (project_id, provider, native_token) DO UPDATE SET \
            env = EXCLUDED.env, \
            user_fingerprint_hex = COALESCE(EXCLUDED.user_fingerprint_hex, device_tokens.user_fingerprint_hex), \
            metadata = EXCLUDED.metadata, \
            revoked_at = NULL, \
            last_seen_at = now(), \
            updated_at = now() \
         RETURNING id, created_at, updated_at",
    )
    .bind(id)
    .bind(project_id)
    .bind(&input.provider)
    .bind(input.env.as_deref())
    .bind(&input.native_token)
    .bind(user_fingerprint_hex)
    .bind(&input.metadata)
    .fetch_one(pool)
    .await?;
    Ok(RegisteredToken {
        id: format_token_handle(row.0),
        created_at: row.1,
        updated_at: row.2,
    })
}

/// Mark `revoked_at = now()`. Idempotent — already-revoked rows
/// stay as-is. Returns true iff a row was found (regardless of
/// whether it was already revoked).
pub async fn revoke_token(
    pool: &PgPool,
    project_id: Uuid,
    token_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(
        "UPDATE device_tokens SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() \
         WHERE id = $1 AND project_id = $2",
    )
    .bind(token_id)
    .bind(project_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}
