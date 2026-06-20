// patch_me + oauth_providers — profile edit + OAuth config discovery.
//
// v1.1 P2 split-out of `api/user_auth.rs`.

use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;

use super::{bad_request, ok_response, server_error, CurrentUser};
use crate::recent::AppState;

#[derive(Deserialize)]
pub struct PatchMeRequest {
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "avatarUrl")]
    pub avatar_url: Option<String>,
}

/// PATCH /auth/me — update display name and/or avatar URL.
pub async fn patch_me(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(body): Json<PatchMeRequest>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("db not configured"),
    };

    if let Some(ref name) = body.display_name {
        let trimmed = name.trim();
        if trimmed.chars().count() > 80 {
            return bad_request("displayNameTooLong");
        }
    }
    if let Some(ref url) = body.avatar_url {
        if url.len() > 512 {
            return bad_request("avatarUrlTooLong");
        }
        if !url.is_empty() && !(url.starts_with("http://") || url.starts_with("https://")) {
            return bad_request("avatarUrlInvalid");
        }
    }

    let mut set_parts: Vec<&'static str> = Vec::new();
    if body.display_name.is_some() {
        set_parts.push("display_name = $1");
    }
    if body.avatar_url.is_some() {
        if body.display_name.is_some() {
            set_parts.push("avatar_url = $2");
        } else {
            set_parts.push("avatar_url = $1");
        }
    }
    if set_parts.is_empty() {
        return ok_response();
    }
    let sql = format!(
        "UPDATE users SET {} WHERE id = ${}",
        set_parts.join(", "),
        set_parts.len() + 1,
    );

    let res = match (body.display_name, body.avatar_url) {
        (Some(name), Some(url)) => {
            sqlx::query(&sql)
                .bind(name)
                .bind(url)
                .bind(user.id)
                .execute(&pool)
                .await
        }
        (Some(name), None) => sqlx::query(&sql).bind(name).bind(user.id).execute(&pool).await,
        (None, Some(url)) => sqlx::query(&sql).bind(url).bind(user.id).execute(&pool).await,
        (None, None) => unreachable!("set_parts emptiness already returned"),
    };
    if res.is_err() {
        return server_error("dbError");
    }
    ok_response()
}

/// GET /auth/oauth/providers — tells the dashboard which OAuth
/// buttons to render. The buttons are hidden when the corresponding
/// env var pair is unset.
pub async fn oauth_providers(State(_state): State<AppState>) -> Response {
    let configured = |k: &str| std::env::var(k).ok().is_some_and(|v| !v.trim().is_empty());
    let github =
        configured("SENTORI_GITHUB_CLIENT_ID") && configured("SENTORI_GITHUB_CLIENT_SECRET");
    let google =
        configured("SENTORI_GOOGLE_CLIENT_ID") && configured("SENTORI_GOOGLE_CLIENT_SECRET");
    (
        StatusCode::OK,
        Json(json!({ "github": github, "google": google })),
    )
        .into_response()
}
