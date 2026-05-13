use axum::{
    extract::{Json, Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::recent::AppState;
use crate::session;

pub const SESSION_COOKIE: &str = "sentori_session";

/// Identifies who's calling an admin API. `require_admin` injects this into
/// request extensions; `require_project_in_org` reads it to decide whether
/// to scope-check the path's `project_id` against the user's orgs.
#[derive(Clone, Debug)]
pub enum AdminCaller {
    /// Authenticated user via DB-backed session cookie.
    User { id: Uuid, email: String },
    /// Legacy `admin_password`-based HMAC cookie (single-tenant super-admin).
    LegacyAdmin,
    /// Bearer dev token (or DB-stored admin token).
    DevToken,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub password: String,
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<LoginRequest>,
) -> Response {
    if !constant_time_eq(body.password.as_bytes(), state.admin_password.as_bytes()) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "unauthorized" })),
        )
            .into_response();
    }

    let token = session::sign(&state.session_secret);
    let cookie = Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .build();

    (StatusCode::OK, jar.add(cookie), Json(json!({ "ok": true }))).into_response()
}

pub async fn logout(jar: CookieJar) -> Response {
    let removed = jar.remove(Cookie::from(SESSION_COOKIE));
    (StatusCode::OK, removed, Json(json!({ "ok": true }))).into_response()
}

pub async fn me(jar: CookieJar, State(state): State<AppState>) -> Response {
    if let Some(c) = jar.get(SESSION_COOKIE) {
        if session::verify(&state.session_secret, c.value()) {
            return (StatusCode::OK, Json(json!({ "ok": true }))).into_response();
        }
    }
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized" })),
    )
        .into_response()
}

/// Allows access if any of:
/// 1. The session cookie resolves to a valid DB-backed user session
///    (Phase 13 sub-B). Caller is set to `AdminCaller::User`.
/// 2. The session cookie has a valid `admin_password` HMAC (legacy
///    single-tenant). Caller is set to `AdminCaller::LegacyAdmin`.
/// 3. A Bearer token accepted by `AuthState::validate`. Caller is set
///    to `AdminCaller::DevToken`.
///
/// The selected caller is stored in request extensions for downstream
/// middleware (`require_project_in_org`) and handlers
/// (`api::admin::list_my_projects`).
pub async fn require_admin(
    State(state): State<AppState>,
    jar: CookieJar,
    mut req: Request,
    next: Next,
) -> Response {
    if let (Some(pool), Some(c)) = (&state.db, jar.get(SESSION_COOKIE)) {
        if let Some((id, email)) =
            crate::api::user_auth::current_user(pool, c.value()).await
        {
            req.extensions_mut().insert(AdminCaller::User { id, email });
            return next.run(req).await;
        }
    }
    if let Some(c) = jar.get(SESSION_COOKIE) {
        if session::verify(&state.session_secret, c.value()) {
            req.extensions_mut().insert(AdminCaller::LegacyAdmin);
            return next.run(req).await;
        }
    }
    let bearer = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "));
    if let Some(token) = bearer {
        if state.auth.validate(token).await {
            req.extensions_mut().insert(AdminCaller::DevToken);
            return next.run(req).await;
        }
    }
    let hint = match bearer {
        Some(token) => crate::auth::token_hint(token),
        None => "log in via the dashboard, or send `Authorization: Bearer <sk_… admin token>` (project settings → tokens)",
    };
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized", "hint": hint })),
    )
        .into_response()
}

/// Path-scoped middleware. Inspects the request URI for a
/// `/projects/{uuid}/...` segment; if found and the caller is a regular
/// user, ensures the project belongs to one of the user's orgs.
/// `LegacyAdmin` and `DevToken` callers are super-users and pass through.
/// Must be mounted *after* `require_admin` so the caller extension is set.
///
/// Phase 18 sub-B: when the project has team bindings (rows in
/// `project_teams`), an org member must additionally be in one of those
/// teams. Org owner/admin always bypass the team check. Projects with
/// no team bindings keep the original "any org member" semantics so
/// pre-existing data stays accessible.
pub async fn require_project_in_org(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let project_id = match extract_project_id_from_path(req.uri().path()) {
        Some(id) => id,
        None => return next.run(req).await,
    };

    let caller = match req.extensions().get::<AdminCaller>() {
        Some(c) => c.clone(),
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "unauthorized" })),
            )
                .into_response();
        }
    };

    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => {
            return next.run(req).await;
        }
    };

    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return next.run(req).await,
    };

    // First check: user is in the project's org at all. role tells us whether
    // the team filter even matters.
    let role: Option<String> = sqlx::query_scalar(
        "SELECT m.role FROM projects p \
         JOIN memberships m ON m.org_id = p.org_id \
         WHERE p.id = $1 AND m.user_id = $2",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let role = match role {
        Some(r) => r,
        None => {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "projectNotInOrg" })),
            )
                .into_response();
        }
    };

    // org owner/admin always pass.
    if matches!(role.as_str(), "owner" | "admin") {
        return next.run(req).await;
    }

    // Plain members hit the team gate when the project has team bindings.
    let team_bound: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM project_teams WHERE project_id = $1)",
    )
    .bind(project_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if !team_bound {
        return next.run(req).await;
    }

    let in_team: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM project_teams pt \
         JOIN team_memberships tm ON tm.team_id = pt.team_id \
         WHERE pt.project_id = $1 AND tm.user_id = $2)",
    )
    .bind(project_id)
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);

    if in_team {
        next.run(req).await
    } else {
        (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "projectNotInTeam" })),
        )
            .into_response()
    }
}

/// Find a UUID in the URI path immediately after a `projects` segment.
/// Returns None for paths that don't include `/projects/<uuid>/...`.
fn extract_project_id_from_path(path: &str) -> Option<Uuid> {
    let mut segs = path.split('/').filter(|s| !s.is_empty());
    while let Some(s) = segs.next() {
        if s == "projects" {
            return segs.next().and_then(|s| Uuid::parse_str(s).ok());
        }
    }
    None
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
