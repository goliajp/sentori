//! Dashboard user auth — register / login / verify-email /
//! forgot+reset password / change password / logout.
//!
//! Phase E step 6 ships the API endpoints with JSON in/out.
//! Cookie-session middleware (axum_middleware::from_fn) lands
//! separately; for now login returns the session id plaintext
//! for the dashboard to store client-side (typical for v0.2 dev).

use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use sentori_auth_session::{AuthOptions, AuthService, RequestMeta};
use sentori_cookie_session::SecretKey;
use sentori_workspace_identity::UserId;
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::{info, warn};

use crate::state::AppState;

fn auth(state: &Arc<AppState>) -> AuthService {
    let raw = std::env::var("SENTORI_SESSION_SECRET").ok();
    let key = match raw {
        Some(s) if s.len() >= 32 => {
            let mut a = [0u8; 32];
            a.copy_from_slice(&s.as_bytes()[..32]);
            SecretKey::from_bytes(a)
        }
        _ => {
            warn!("SENTORI_SESSION_SECRET missing or < 32 bytes; using ephemeral key (sessions reset on restart)");
            SecretKey::generate().expect("session key generate")
        }
    };
    AuthService::new(state.identity.clone(), key, AuthOptions::default())
}

fn meta() -> RequestMeta {
    RequestMeta {
        ip: None,
        user_agent: None,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterBody {
    pub email: String,
    pub password: String,
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterBody>,
) -> (StatusCode, Json<Value>) {
    if body.email.is_empty() || body.password.len() < 12 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "email + password (≥12 chars) required" })),
        );
    }
    match auth(&state).register(&body.email, &body.password).await {
        Ok((user, minted)) => {
            info!(user_id = %user.id, "auth.register");
            (
                StatusCode::CREATED,
                Json(json!({
                    "user_id": user.id.to_string(),
                    "verify_token": minted.plaintext_token.to_wire_string(),
                })),
            )
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginBody {
    pub email: String,
    pub password: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginBody>,
) -> (StatusCode, Json<Value>) {
    match auth(&state).login(&body.email, &body.password, &meta()).await {
        Ok((user, minted)) => {
            info!(user_id = %user.id, "auth.login");
            (
                StatusCode::OK,
                Json(json!({
                    "user_id": user.id.to_string(),
                    "email": user.email,
                    "session_token": minted.session_id.to_wire_string(),
                    "expires_at": minted.session.expires_at,
                })),
            )
        }
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyBody {
    pub token: String,
}

pub async fn verify(
    State(state): State<Arc<AppState>>,
    Json(body): Json<VerifyBody>,
) -> (StatusCode, Json<Value>) {
    match auth(&state).verify_email(&body.token).await {
        Ok(uid) => (StatusCode::OK, Json(json!({ "user_id": uid.to_string() }))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgotBody {
    pub email: String,
}

pub async fn forgot(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ForgotBody>,
) -> (StatusCode, Json<Value>) {
    match auth(&state).forgot_password(&body.email).await {
        Ok(Some(minted)) => (
            StatusCode::OK,
            Json(json!({ "reset_token": minted.plaintext_token.to_wire_string() })),
        ),
        Ok(None) => (
            StatusCode::OK,
            Json(json!({ "status": "if registered, an email is sent" })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetBody {
    pub token: String,
    pub new_password: String,
}

pub async fn reset(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ResetBody>,
) -> (StatusCode, Json<Value>) {
    match auth(&state)
        .reset_password(&body.token, &body.new_password)
        .await
    {
        Ok(uid) => (StatusCode::OK, Json(json!({ "user_id": uid.to_string() }))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordBody {
    pub user_id: uuid::Uuid,
    pub current_password: String,
    pub new_password: String,
    /// 32-byte session id hash (hex) of the calling session — kept
    /// alive after the rotate.
    pub keep_session_id_hex: String,
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ChangePasswordBody>,
) -> (StatusCode, Json<Value>) {
    let keep = match hex::decode(&body.keep_session_id_hex) {
        Ok(b) if b.len() == 32 => {
            let mut a = [0u8; 32];
            a.copy_from_slice(&b);
            a
        }
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "keep_session_id_hex must be 32 bytes hex" })),
            );
        }
    };
    match auth(&state)
        .change_password(
            UserId::from_uuid(body.user_id),
            &body.current_password,
            &body.new_password,
            &keep,
        )
        .await
    {
        Ok(()) => (StatusCode::NO_CONTENT, Json(json!({}))),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": e.to_string() })),
        ),
    }
}
