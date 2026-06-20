// Phase 18 sub-B: Team CRUD + members + project↔team binding.
//
// v1.1 P2: split from the 862-line `api/teams.rs` into three
// logical sub-files (`crud`, `members`, `projects`). The pub
// surface is preserved via `pub use` re-exports, so router and
// other api modules keep calling `api::teams::create_team`,
// `api::teams::resolve_membership`, etc. unchanged.
//
// Teams are sub-groupings inside an org. Once a project is bound to
// one or more teams, only members of those teams (plus org
// owner/admin) can access the project — see
// `admin_auth::require_project_in_org` for the runtime enforcement.

use axum::{
    extract::Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;

// ── constants ──────────────────────────────────────────────────────────
pub(super) const SLUG_MIN: usize = 3;
pub(super) const SLUG_MAX: usize = 32;
pub(super) const NAME_MIN: usize = 1;
pub(super) const NAME_MAX: usize = 64;
pub(super) const DESC_MAX: usize = 280;

// ── response shapes shared across the sub-modules ──────────────────────

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct TeamRow {
    pub(super) id: Uuid,
    pub(super) org_id: Uuid,
    pub(super) slug: String,
    pub(super) name: String,
    pub(super) description: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub(super) created_at: OffsetDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct TeamMemberRow {
    pub(super) user_id: Uuid,
    pub(super) email: String,
    pub(super) role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub(super) created_at: OffsetDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectRow {
    pub(super) id: Uuid,
    pub(super) name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub(super) created_at: OffsetDateTime,
}

// ── DB helpers (some exposed crate-wide for views/alert_rules) ─────────

pub(crate) async fn resolve_membership(
    pool: &PgPool,
    slug: &str,
    user_id: Uuid,
) -> Option<(Uuid, String)> {
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT o.id, m.role FROM orgs o \
         JOIN memberships m ON m.org_id = o.id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(slug)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

pub(crate) async fn resolve_team(pool: &PgPool, org_id: Uuid, team_slug: &str) -> Option<Uuid> {
    sqlx::query_scalar("SELECT id FROM teams WHERE org_id = $1 AND slug = $2")
        .bind(org_id)
        .bind(team_slug)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

pub(crate) async fn project_org(pool: &PgPool, project_id: Uuid) -> Option<(Uuid, String)> {
    sqlx::query_as::<_, (Uuid, String)>("SELECT org_id, name FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

pub(super) async fn is_team_lead(pool: &PgPool, team_id: Uuid, user_id: Uuid) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM team_memberships \
         WHERE team_id = $1 AND user_id = $2 AND role = 'lead')",
    )
    .bind(team_id)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(false)
}

pub(super) async fn caller_is_org_admin(
    pool: &PgPool,
    caller: &AdminCaller,
    org_id: Uuid,
) -> bool {
    match caller {
        AdminCaller::User { id, .. } => {
            let role: Option<String> = sqlx::query_scalar(
                "SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2",
            )
            .bind(org_id)
            .bind(*id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
            role.as_deref().map(is_org_admin).unwrap_or(false)
        }
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => true,
    }
}

// ── validation + response shape helpers ────────────────────────────────

pub(super) fn is_org_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

pub(super) fn actor_user_id(caller: &AdminCaller) -> Option<Uuid> {
    match caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    }
}

pub(super) fn is_valid_slug(s: &str) -> bool {
    let len = s.len();
    if len < SLUG_MIN || len > SLUG_MAX {
        return false;
    }
    if s.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub(super) fn is_valid_name(s: &str) -> bool {
    let len = s.chars().count();
    len >= NAME_MIN && len <= NAME_MAX
}

pub(super) fn ok_response() -> Response {
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

pub(super) fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

pub(super) fn conflict(error: &str) -> Response {
    (StatusCode::CONFLICT, Json(json!({ "error": error }))).into_response()
}

pub(super) fn forbidden(error: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": error }))).into_response()
}

pub(super) fn not_found(error: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": error }))).into_response()
}

pub(super) fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}

// ── sub-modules + re-exports ────────────────────────────────────────────

mod crud;
mod members;
mod projects;

pub use crud::{
    create_team, delete_team, get_team, list_teams, patch_team, CreateTeamBody, PatchTeamBody,
};
pub use members::{
    add_team_member, list_team_members, patch_team_member, remove_team_member,
    AddTeamMemberBody, PatchTeamMemberBody,
};
pub use projects::{
    assign_project_to_team, list_project_teams, list_team_projects, unassign_project_from_team,
};
