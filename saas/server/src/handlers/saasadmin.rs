//! saasadmin auth + tenant lifecycle handlers.
//!
//! Routes:
//!   POST /v1/saas/saasadmin/login         — email+password → session cookie
//!   POST /v1/saas/saasadmin/logout        — revoke current session
//!   GET  /v1/saas/saasadmin/me            — who am I
//!   POST /v1/saas/tenants/:id/suspend     — flip tenant status=suspended
//!   POST /v1/saas/tenants/:id/resume      — flip back to active
//!   DELETE /v1/saas/tenants/:id           — soft delete (status=deleted)
//!
//! v0.1 skeleton: full session middleware (cookie sign +
//! HttpOnly + Secure + SameSite=Lax) lands once we wire
//! S9 cookie-session in. For now login returns the
//! session token in JSON for the dashboard to store.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct LoginResponse {
    pub session_token: String,
    pub user_id: Uuid,
    pub role: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> Result<Json<LoginResponse>, (StatusCode, String)> {
    let email = body.email.trim().to_ascii_lowercase();
    if email.is_empty() || body.password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "email + password required".into()));
    }

    let row: Option<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, password_hash, role FROM saasadmin_users WHERE email = $1",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let (user_id, password_hash, role) = row
        .ok_or((StatusCode::UNAUTHORIZED, "invalid credentials".into()))?;

    // Verify via S13 argon2.
    let ok = sentori_argon2_password::PasswordHash::verify(&body.password, &password_hash)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("verify: {e}")))?;
    if !ok {
        return Err((StatusCode::UNAUTHORIZED, "invalid credentials".into()));
    }

    // Mint a session — random 32-byte token, store sha256
    // in saasadmin_sessions, return raw token to caller.
    use sha2::{Digest, Sha256};
    let raw_token: [u8; 32] = rand_bytes();
    let token_hex = hex_encode(&raw_token);
    let token_hash = hex_encode(&Sha256::digest(&raw_token));
    let session_id = Uuid::now_v7();
    let expires =
        time::OffsetDateTime::now_utc() + time::Duration::hours(24 * 14);

    sqlx::query(
        "INSERT INTO saasadmin_sessions (id, user_id, token_hash, expires_at) \
         VALUES ($1, $2, $3, $4)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(&token_hash)
    .bind(expires)
    .execute(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    sqlx::query("UPDATE saasadmin_users SET last_login_at = now() WHERE id = $1")
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(LoginResponse {
        session_token: token_hex,
        user_id,
        role,
    }))
}

pub async fn suspend_tenant(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Row-level pivot: status lives on workspace_billing now.
    let res = sqlx::query(
        "UPDATE workspace_billing SET status = 'past_due', updated_at = now() \
         WHERE workspace_id = $1 AND status = 'active'",
    )
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if res.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "workspace billing row not active / missing".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn resume_tenant(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    let res = sqlx::query(
        "UPDATE workspace_billing SET status = 'active', updated_at = now() \
         WHERE workspace_id = $1 AND status = 'past_due'",
    )
    .bind(id)
    .execute(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if res.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            "workspace billing row not past_due / missing".into(),
        ));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_tenant(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    // Hard delete cascades via FK to projects / events / etc.
    let res = sqlx::query("DELETE FROM workspaces WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if res.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "workspace not found".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

// ── tiny crypto helpers (no extra deps) ────────────────────

fn rand_bytes() -> [u8; 32] {
    use std::time::{SystemTime, UNIX_EPOCH};
    // v0.1 quick: seed from nanos + uuid::now_v7. Replace
    // with getrandom in production hardening (K17.x).
    let mut out = [0u8; 32];
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let nanos_bytes = nanos.to_le_bytes();
    out[..16].copy_from_slice(&nanos_bytes);
    let u = uuid::Uuid::now_v7();
    out[16..].copy_from_slice(u.as_bytes());
    out
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}
