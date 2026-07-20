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
            warn!(
                "SENTORI_SESSION_SECRET missing or < 32 bytes; using ephemeral key (sessions reset on restart)"
            );
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
            // The verify token goes out by email ONLY — returning
            // it here would let any caller self-verify.
            state.mailer.send_verify(
                state.workspace_id,
                &body.email,
                &minted.plaintext_token.to_wire_string(),
            );
            (
                StatusCode::CREATED,
                Json(json!({
                    "user_id": user.id.to_string(),
                    "status": "verification email sent",
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
) -> axum::response::Response {
    use axum::http::header::{HeaderValue, SET_COOKIE};
    use axum::response::IntoResponse;

    let auth_svc = auth(&state);
    match auth_svc.login(&body.email, &body.password, &meta()).await {
        Ok((user, minted)) => {
            info!(user_id = %user.id, "auth.login");
            let raw = minted.session_id.to_wire_string();
            // Seal the raw wire token into the signed cookie form
            // that lookup_session expects. session_token in the body
            // is the signed value too so cli / Bearer clients can use
            // the exact same string they would put in the cookie.
            let signed =
                sentori_cookie_session::SignedCookie::seal(auth_svc.cookie_key(), raw.as_bytes());
            let body_json = json!({
                "user_id": user.id.to_string(),
                "email": user.email,
                "session_token": signed,
                "expires_at": minted.session.expires_at,
            });
            let mut resp = (StatusCode::OK, Json(body_json)).into_response();
            let cookie = format!(
                "sentori_session={signed}; Path=/; HttpOnly; SameSite=Lax{}",
                if secure_cookies() { "; Secure" } else { "" },
            );
            if let Ok(hv) = HeaderValue::from_str(&cookie) {
                resp.headers_mut().insert(SET_COOKIE, hv);
            }
            resp
        }
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

fn secure_cookies() -> bool {
    // Default ON; flip OFF for local-dev plain HTTP.
    !matches!(
        std::env::var("SENTORI_COOKIE_SECURE").ok().as_deref(),
        Some("0") | Some("false")
    )
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
        // Same response for hit and miss (anti-enumeration), and
        // the token travels by email ONLY — returning it here
        // hands account takeover to any caller.
        Ok(minted) => {
            if let Some(minted) = minted {
                state.mailer.send_reset(
                    state.workspace_id,
                    &body.email,
                    &minted.plaintext_token.to_wire_string(),
                );
            }
            (
                StatusCode::OK,
                Json(json!({ "status": "if registered, an email is sent" })),
            )
        }
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

pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
) -> axum::response::Response {
    use axum::http::header::{HeaderValue, SET_COOKIE};
    use axum::response::IntoResponse;

    if let Some(token) = extract_session_token(&headers) {
        let svc = auth(&state);
        if let Ok(Some((_user, session))) = svc.lookup_session(&token).await {
            if let Ok(hash) = hex::decode(&session.id_hash_hex) {
                if hash.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&hash);
                    let _ = svc.logout(&arr).await;
                }
            }
        }
    }
    let mut resp = StatusCode::NO_CONTENT.into_response();
    let cookie = format!(
        "sentori_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax{}",
        if secure_cookies() { "; Secure" } else { "" },
    );
    if let Ok(hv) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().insert(SET_COOKIE, hv);
    }
    resp
}

pub async fn me(
    axum::extract::Extension(ctx): axum::extract::Extension<crate::session_mw::SessionContext>,
    State(state): State<Arc<AppState>>,
) -> Json<Value> {
    match state.identity.users().find_by_id(ctx.user_id).await {
        Ok(Some(u)) => Json(json!({
            "user_id": u.id.to_string(),
            "email": u.email,
            "email_verified": u.email_verified,
            "created_at": u.created_at,
        })),
        _ => Json(json!({ "error": "user_not_found" })),
    }
}

fn extract_session_token(headers: &axum::http::HeaderMap) -> Option<String> {
    use axum::http::header;
    if let Some(auth) = headers.get(header::AUTHORIZATION) {
        if let Ok(s) = auth.to_str() {
            if let Some(rest) = s.strip_prefix("Bearer ") {
                return Some(rest.trim().to_string());
            }
        }
    }
    if let Some(cookie_hdr) = headers.get(header::COOKIE) {
        if let Ok(s) = cookie_hdr.to_str() {
            for part in s.split(';') {
                let p = part.trim();
                if let Some(rest) = p.strip_prefix("sentori_session=") {
                    return Some(rest.trim().to_string());
                }
            }
        }
    }
    None
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
