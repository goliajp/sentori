// v1.0 — operator god-mode endpoints.
//
// These return cross-org data (every user / every org / every project
// on the instance) and are gated by `users.is_superadmin = TRUE`. The
// LegacyAdmin / DevToken admin password is intentionally NOT accepted
// here — that's an operator break-glass for the dashboard's admin
// surfaces, and the dashboard's admin surfaces themselves go through
// `require_admin`. This is for normal-session users with the elevated
// flag.

use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::FromRow;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::user_auth::{current_user, SESSION_COOKIE};
use crate::recent::AppState;

/// Middleware guarding every endpoint in this module.
///
/// Resolves the cookie session through `current_user` (the same path
/// `require_user` uses), then asserts `is_superadmin = TRUE` on that
/// row. 401 when there's no session, 403 when the session exists but
/// the user isn't a superadmin.
pub async fn require_superadmin(
    State(state): State<AppState>,
    jar: CookieJar,
    mut req: Request,
    next: Next,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let session_id = match jar.get(SESSION_COOKIE) {
        Some(c) => c.value().to_string(),
        None => return unauthorized(),
    };
    let Some((user_id, _email)) = current_user(&pool, &session_id).await else {
        return unauthorized();
    };
    let is_super: Option<(bool,)> =
        sqlx::query_as("SELECT is_superadmin FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    if !matches!(is_super, Some((true,))) {
        return forbidden();
    }
    req.extensions_mut().insert(SuperadminCaller { id: user_id });
    next.run(req).await
}

#[derive(Clone, Debug)]
#[allow(dead_code)] // id may be useful for audit log later
pub struct SuperadminCaller {
    pub id: Uuid,
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserRow {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub email_verified: bool,
    pub is_superadmin: bool,
    pub oauth_provider: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub org_count: i64,
}

/// GET /admin/api/superadmin/users — every user on the instance.
pub async fn list_users(State(state): State<AppState>) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let rows: Vec<AdminUserRow> = match sqlx::query_as(
        r#"
        SELECT u.id, u.email, u.display_name, u.avatar_url, u.email_verified,
               u.is_superadmin, u.oauth_provider, u.created_at,
               (SELECT count(*) FROM memberships m WHERE m.user_id = u.id) AS org_count
        FROM users u
        ORDER BY u.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "superadmin.list_users: query failed");
            return server_error("dbError");
        }
    };
    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
pub struct PatchUserBody {
    #[serde(rename = "isSuperadmin")]
    pub is_superadmin: Option<bool>,
}

/// PATCH /admin/api/superadmin/users/:id — flip the superadmin flag.
pub async fn patch_user(
    State(state): State<AppState>,
    Path(target_id): Path<Uuid>,
    Json(body): Json<PatchUserBody>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let Some(flag) = body.is_superadmin else {
        return bad_request("nothingToUpdate");
    };
    if sqlx::query("UPDATE users SET is_superadmin = $1 WHERE id = $2")
        .bind(flag)
        .bind(target_id)
        .execute(pool)
        .await
        .is_err()
    {
        return server_error("dbError");
    }
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdminOrgRow {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub owner_id: Uuid,
    pub owner_email: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub member_count: i64,
    pub project_count: i64,
}

/// GET /admin/api/superadmin/orgs — every org on the instance.
pub async fn list_orgs(State(state): State<AppState>) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let rows: Vec<AdminOrgRow> = match sqlx::query_as(
        r#"
        SELECT o.id, o.slug, o.name, o.owner_id,
               (SELECT email FROM users WHERE id = o.owner_id) AS owner_email,
               o.created_at,
               (SELECT count(*) FROM memberships m WHERE m.org_id = o.id) AS member_count,
               (SELECT count(*) FROM projects p WHERE p.org_id = o.id) AS project_count
        FROM orgs o
        ORDER BY o.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "superadmin.list_orgs: query failed");
            return server_error("dbError");
        }
    };
    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdminProjectRow {
    pub id: Uuid,
    pub name: String,
    pub org_id: Uuid,
    pub org_slug: String,
    pub source_repo_url: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub event_count_30d: i64,
}

/// GET /admin/api/superadmin/projects — every project on the instance.
pub async fn list_projects(State(state): State<AppState>) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return server_error("dbNotConfigured");
    };
    let rows: Vec<AdminProjectRow> = match sqlx::query_as(
        r#"
        SELECT p.id, p.name, p.org_id, o.slug AS org_slug, p.source_repo_url,
               p.created_at,
               COALESCE((
                 SELECT count(*) FROM events e
                 WHERE e.project_id = p.id AND e.received_at > now() - INTERVAL '30 days'
               ), 0) AS event_count_30d
        FROM projects p
        JOIN orgs o ON o.id = p.org_id
        ORDER BY p.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "superadmin.list_projects: query failed");
            return server_error("dbError");
        }
    };
    (StatusCode::OK, Json(rows)).into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "unauthorized" })),
    )
        .into_response()
}

fn forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({ "error": "notSuperadmin" })),
    )
        .into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
