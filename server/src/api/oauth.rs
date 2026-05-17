// v1.0 — OAuth 2.0 authorization-code flow for GitHub + Google.
//
// Hand-rolled (no `oauth2` crate) since both providers' implementations
// of the standard are small and we already depend on reqwest. Cuts
// ~30 transitive crates from the build.
//
// Two endpoints per provider:
//
//   GET /auth/oauth/{provider}/start
//       Issues a 256-bit random state token, sets it as a 10-minute
//       HttpOnly cookie, and 302s the user to the provider's
//       authorize URL.
//
//   GET /auth/oauth/{provider}/callback?code&state
//       Verifies state == cookie, exchanges code for an access
//       token via the token endpoint, fetches user info, and:
//         1. if a user with the same (oauth_provider, oauth_subject)
//            exists → log them in
//         2. else if a user with the same email exists → link the
//            OAuth identity to that row, then log in
//         3. else → register a new verified user, log in
//       Either way: creates an auth_sessions row, sets the
//       session cookie, redirects to /.
//
// Environment:
//   SENTORI_BASE_URL                 → callback URL prefix
//   SENTORI_GITHUB_CLIENT_ID/SECRET  → GitHub OAuth app credentials
//   SENTORI_GOOGLE_CLIENT_ID/SECRET  → Google OAuth client credentials
//
// Both providers must have their callback URL set to
// `${SENTORI_BASE_URL}/auth/oauth/{provider}/callback`. The dashboard
// reads /auth/oauth/providers to know which buttons to render.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::api::user_auth::{random_token, SESSION_COOKIE};
use crate::recent::AppState;

const STATE_COOKIE: &str = "sentori_oauth_state";
const STATE_TTL_MIN: i64 = 10;
const SESSION_TTL_DAYS: i64 = 30;

struct ProviderConfig {
    name: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    user_info_url: &'static str,
    scope: &'static str,
    /// Provider returns user info as a generic JSON; this function
    /// maps it to (provider_subject, email, display_name, avatar_url).
    extract_user: fn(&Value) -> Option<UserInfo>,
}

struct UserInfo {
    subject: String,
    email: String,
    display_name: Option<String>,
    avatar_url: Option<String>,
}

fn resolve_provider(name: &str) -> Option<ProviderConfig> {
    match name {
        "github" => Some(ProviderConfig {
            name: "github",
            authorize_url: "https://github.com/login/oauth/authorize",
            token_url: "https://github.com/login/oauth/access_token",
            user_info_url: "https://api.github.com/user",
            scope: "read:user user:email",
            extract_user: extract_github,
        }),
        "google" => Some(ProviderConfig {
            name: "google",
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            user_info_url: "https://openidconnect.googleapis.com/v1/userinfo",
            scope: "openid email profile",
            extract_user: extract_google,
        }),
        _ => None,
    }
}

fn extract_github(v: &Value) -> Option<UserInfo> {
    let id = v.get("id").and_then(|x| x.as_i64())?;
    let email = v.get("email").and_then(|x| x.as_str())?;
    if email.is_empty() {
        return None;
    }
    Some(UserInfo {
        subject: id.to_string(),
        email: email.to_ascii_lowercase(),
        display_name: v
            .get("name")
            .and_then(|x| x.as_str())
            .or_else(|| v.get("login").and_then(|x| x.as_str()))
            .map(|s| s.to_string()),
        avatar_url: v
            .get("avatar_url")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
    })
}

fn extract_google(v: &Value) -> Option<UserInfo> {
    let sub = v.get("sub").and_then(|x| x.as_str())?;
    let email = v.get("email").and_then(|x| x.as_str())?;
    let verified = v
        .get("email_verified")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    if !verified {
        return None;
    }
    Some(UserInfo {
        subject: sub.to_string(),
        email: email.to_ascii_lowercase(),
        display_name: v
            .get("name")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        avatar_url: v
            .get("picture")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
    })
}

fn provider_credentials(name: &str) -> Option<(String, String)> {
    let upper = match name {
        "github" => "GITHUB",
        "google" => "GOOGLE",
        _ => return None,
    };
    let id = std::env::var(format!("SENTORI_{upper}_CLIENT_ID")).ok()?;
    let secret = std::env::var(format!("SENTORI_{upper}_CLIENT_SECRET")).ok()?;
    if id.is_empty() || secret.is_empty() {
        return None;
    }
    Some((id, secret))
}

fn callback_url(state: &AppState, provider: &str) -> String {
    format!("{}/auth/oauth/{}/callback", state.base_url, provider)
}

/// GET /auth/oauth/{provider}/start
pub async fn start(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    jar: CookieJar,
) -> Response {
    let Some(cfg) = resolve_provider(&provider) else {
        return bad_request("unknownProvider");
    };
    let Some((client_id, _secret)) = provider_credentials(cfg.name) else {
        return bad_request("oauthNotConfigured");
    };

    let token = random_token(32);
    let redirect_uri = callback_url(&state, cfg.name);

    // Encode the URL params. Use form_urlencoded so reserved
    // characters in scope (`:`) are handled correctly.
    let params = url_encode(&[
        ("client_id", client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("scope", cfg.scope),
        ("state", token.as_str()),
        ("response_type", "code"),
        // Google needs prompt + access_type to be a meaningful login flow.
        ("prompt", "select_account"),
    ]);
    let location = format!("{}?{}", cfg.authorize_url, params);

    let secure = state.base_url.starts_with("https://");
    let cookie = Cookie::build((STATE_COOKIE, token))
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .max_age(Duration::minutes(STATE_TTL_MIN))
        .build();

    (jar.add(cookie), Redirect::to(&location)).into_response()
}

#[derive(Deserialize)]
pub struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// GET /auth/oauth/{provider}/callback?code&state
pub async fn callback(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(params): Query<CallbackParams>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Response {
    let Some(cfg) = resolve_provider(&provider) else {
        return bad_request("unknownProvider");
    };
    let Some((client_id, client_secret)) = provider_credentials(cfg.name) else {
        return bad_request("oauthNotConfigured");
    };

    if let Some(err) = params.error.as_deref() {
        tracing::warn!(provider = %cfg.name, error = %err, "oauth: provider returned error");
        return Redirect::to("/login?oauth=denied").into_response();
    }

    let (Some(code), Some(returned_state)) = (params.code, params.state) else {
        return bad_request("missingCodeOrState");
    };

    let expected_state = jar
        .get(STATE_COOKIE)
        .map(|c| c.value().to_string())
        .unwrap_or_default();
    if expected_state.is_empty() || expected_state != returned_state {
        tracing::warn!(provider = %cfg.name, "oauth: state mismatch");
        return bad_request("stateMismatch");
    }

    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    // 1. Exchange the code for an access token.
    let redirect_uri = callback_url(&state, cfg.name);
    let client = reqwest::Client::builder()
        .user_agent("sentori-server/v1.0")
        .build()
        .expect("reqwest client");

    let token_form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id.clone()),
        ("client_secret", client_secret),
    ];

    let token_resp = match client
        .post(cfg.token_url)
        .header("Accept", "application/json")
        .form(&token_form)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "oauth: token exchange request failed");
            return server_error("tokenExchangeFailed");
        }
    };

    if !token_resp.status().is_success() {
        let status = token_resp.status();
        let body = token_resp.text().await.unwrap_or_default();
        tracing::warn!(provider = %cfg.name, %status, body = %body, "oauth: token exchange non-2xx");
        return server_error("tokenExchangeFailed");
    }

    let token_body: Value = match token_resp.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "oauth: token response parse failed");
            return server_error("tokenParseFailed");
        }
    };
    let access_token = match token_body.get("access_token").and_then(|x| x.as_str()) {
        Some(t) => t.to_string(),
        None => {
            tracing::warn!(provider = %cfg.name, body = %token_body, "oauth: no access_token in response");
            return server_error("tokenMissing");
        }
    };

    // 2. Fetch user info.
    let info_resp = match client
        .get(cfg.user_info_url)
        .bearer_auth(&access_token)
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "oauth: userinfo fetch failed");
            return server_error("userInfoFailed");
        }
    };

    let info_body: Value = match info_resp.json().await {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "oauth: userinfo parse failed");
            return server_error("userInfoParseFailed");
        }
    };

    // GitHub's /user endpoint returns email = null when the primary
    // is private. Fall back to /user/emails for the verified primary.
    let info_body = if cfg.name == "github" && info_body.get("email").map(|x| x.is_null()).unwrap_or(true) {
        match fetch_github_primary_email(&client, &access_token).await {
            Some(email) => {
                let mut patched = info_body.clone();
                patched["email"] = Value::String(email);
                patched
            }
            None => info_body,
        }
    } else {
        info_body
    };

    let user_info = match (cfg.extract_user)(&info_body) {
        Some(ui) => ui,
        None => {
            tracing::warn!(provider = %cfg.name, "oauth: failed to extract user info (missing fields / unverified email)");
            return bad_request("emailUnverifiedOrMissing");
        }
    };

    // 3. Account-link / register, then issue a session.
    let user_id = match upsert_oauth_user(&pool, cfg.name, &user_info).await {
        Ok(id) => id,
        Err(e) => {
            tracing::error!(error = %e, "oauth: upsert user failed");
            return server_error("upsertFailed");
        }
    };

    let session_id = random_token(32);
    let expires_at = OffsetDateTime::now_utc() + Duration::days(SESSION_TTL_DAYS);
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string());
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if sqlx::query(
        "INSERT INTO auth_sessions (id, user_id, expires_at, ip, user_agent) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&session_id)
    .bind(user_id)
    .bind(expires_at)
    .bind(ip.as_deref())
    .bind(user_agent.as_deref())
    .execute(&pool)
    .await
    .is_err()
    {
        return server_error("sessionFailed");
    }

    let secure = state.base_url.starts_with("https://");
    let session_cookie = Cookie::build((SESSION_COOKIE, session_id))
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .max_age(Duration::days(SESSION_TTL_DAYS))
        .build();
    let state_clear = Cookie::build((STATE_COOKIE, ""))
        .path("/")
        .max_age(Duration::seconds(0))
        .build();

    (
        jar.add(session_cookie).add(state_clear),
        Redirect::to("/"),
    )
        .into_response()
}

async fn fetch_github_primary_email(client: &reqwest::Client, token: &str) -> Option<String> {
    let resp = client
        .get("https://api.github.com/user/emails")
        .bearer_auth(token)
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let emails: Vec<Value> = resp.json().await.ok()?;
    emails
        .into_iter()
        .filter(|e| {
            e.get("verified").and_then(|x| x.as_bool()).unwrap_or(false)
                && e.get("primary").and_then(|x| x.as_bool()).unwrap_or(false)
        })
        .next()
        .and_then(|e| {
            e.get("email")
                .and_then(|x| x.as_str())
                .map(|s| s.to_ascii_lowercase())
        })
}

async fn upsert_oauth_user(
    pool: &PgPool,
    provider: &str,
    info: &UserInfo,
) -> Result<Uuid, sqlx::Error> {
    // 1. Look up by (oauth_provider, oauth_subject) — the stable
    // upstream identifier.
    if let Some((id,)) = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM users WHERE oauth_provider = $1 AND oauth_subject = $2",
    )
    .bind(provider)
    .bind(&info.subject)
    .fetch_optional(pool)
    .await?
    {
        // Refresh display_name + avatar_url to whatever the
        // provider has now (cheap update; harmless if unchanged).
        sqlx::query(
            "UPDATE users SET \
               display_name = COALESCE($1, display_name), \
               avatar_url   = COALESCE($2, avatar_url) \
             WHERE id = $3",
        )
        .bind(info.display_name.as_deref())
        .bind(info.avatar_url.as_deref())
        .bind(id)
        .execute(pool)
        .await?;
        return Ok(id);
    }

    // 2. Fall back to email lookup → link OAuth to the existing row.
    if let Some((id,)) =
        sqlx::query_as::<_, (Uuid,)>("SELECT id FROM users WHERE email = $1")
            .bind(&info.email)
            .fetch_optional(pool)
            .await?
    {
        sqlx::query(
            "UPDATE users SET \
               oauth_provider = $1, oauth_subject = $2, \
               display_name = COALESCE(display_name, $3), \
               avatar_url   = COALESCE(avatar_url,   $4), \
               email_verified = TRUE \
             WHERE id = $5",
        )
        .bind(provider)
        .bind(&info.subject)
        .bind(info.display_name.as_deref())
        .bind(info.avatar_url.as_deref())
        .bind(id)
        .execute(pool)
        .await?;
        return Ok(id);
    }

    // 3. New row — random password_hash so the column constraint
    // holds, but the row can never password-login (the hash isn't
    // a valid argon2 string).
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, email_verified, \
                            oauth_provider, oauth_subject, display_name, avatar_url) \
         VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(&info.email)
    .bind(format!("oauth:{provider}:no-password"))
    .bind(provider)
    .bind(&info.subject)
    .bind(info.display_name.as_deref())
    .bind(info.avatar_url.as_deref())
    .execute(pool)
    .await?;
    Ok(id)
}

fn url_encode(pairs: &[(&str, &str)]) -> String {
    let mut out = String::new();
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            out.push('&');
        }
        out.push_str(&urlencoding::encode(k));
        out.push('=');
        out.push_str(&urlencoding::encode(v));
    }
    out
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
