// Phase 18 sub-B: Team CRUD + members + project↔team binding.
//
// Teams are sub-groupings inside an org. Once a project is bound to one or
// more teams, only members of those teams (plus org owner/admin) can access
// the project — see `admin_auth::require_project_in_org` for the runtime
// enforcement.
//
// Endpoints split across two routers:
//   - team & member CRUD under `/api/orgs/{slug}/teams/...`  (require_user)
//   - project↔team binding under `/admin/api/projects/{project_id}/teams/...`
//     (require_admin + require_project_in_org)
//
// Audit logging lands in sub-C; this module focuses on the data plane.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::api::user_auth::CurrentUser;
use crate::recent::AppState;

const SLUG_MIN: usize = 3;
const SLUG_MAX: usize = 32;
const NAME_MIN: usize = 1;
const NAME_MAX: usize = 64;
const DESC_MAX: usize = 280;
const VALID_TEAM_ROLES: &[&str] = &["lead", "member"];

// ---------- response shapes ----------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct TeamRow {
    id: Uuid,
    org_id: Uuid,
    slug: String,
    name: String,
    description: Option<String>,
    created_at: OffsetDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct TeamMemberRow {
    user_id: Uuid,
    email: String,
    role: String,
    created_at: OffsetDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ProjectRow {
    id: Uuid,
    name: String,
    created_at: OffsetDateTime,
}

// ---------- team CRUD ----------

pub async fn list_teams(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, _role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };

    let rows: Vec<TeamRow> = sqlx::query_as(
        "SELECT id, org_id, slug, name, description, created_at \
         FROM teams WHERE org_id = $1 ORDER BY created_at",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
pub struct CreateTeamBody {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
}

pub async fn create_team(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(org_slug): Path<String>,
    Json(body): Json<CreateTeamBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if !is_org_admin(&role) {
        return forbidden("forbidden");
    }

    let team_slug = body.slug.trim().to_ascii_lowercase();
    if !is_valid_slug(&team_slug) {
        return bad_request("invalidSlug");
    }
    let name = body.name.trim().to_string();
    if !is_valid_name(&name) {
        return bad_request("invalidName");
    }
    let description = body.description.as_ref().map(|s| s.trim().to_string());
    if let Some(d) = &description
        && d.chars().count() > DESC_MAX
    {
        return bad_request("descriptionTooLong");
    }

    let team_id = Uuid::now_v7();
    let res = sqlx::query(
        "INSERT INTO teams (id, org_id, slug, name, description) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(team_id)
    .bind(org_id)
    .bind(&team_slug)
    .bind(&name)
    .bind(description.as_deref())
    .execute(&pool)
    .await;

    if let Err(e) = res {
        if let sqlx::Error::Database(db_err) = &e
            && db_err.is_unique_violation()
        {
            return conflict("slugTaken");
        }
        tracing::error!(error = %e, "insert team failed");
        return server_error("insertTeam");
    }

    (
        StatusCode::CREATED,
        Json(json!({
            "id": team_id,
            "orgId": org_id,
            "slug": team_slug,
            "name": name,
            "description": description,
        })),
    )
        .into_response()
}

pub async fn get_team(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, _role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };

    let row: Option<TeamRow> = sqlx::query_as(
        "SELECT id, org_id, slug, name, description, created_at \
         FROM teams WHERE org_id = $1 AND slug = $2",
    )
    .bind(org_id)
    .bind(&team_slug)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    match row {
        Some(r) => (StatusCode::OK, Json(r)).into_response(),
        None => not_found("teamNotFound"),
    }
}

#[derive(Deserialize)]
pub struct PatchTeamBody {
    pub name: Option<String>,
    pub description: Option<String>,
}

pub async fn patch_team(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug)): Path<(String, String)>,
    Json(body): Json<PatchTeamBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if !is_org_admin(&role) {
        return forbidden("forbidden");
    }

    let team_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM teams WHERE org_id = $1 AND slug = $2",
    )
    .bind(org_id)
    .bind(&team_slug)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let team_id = match team_id {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };

    if let Some(name) = body.name.as_ref().map(|s| s.trim().to_string()) {
        if !is_valid_name(&name) {
            return bad_request("invalidName");
        }
        if let Err(e) = sqlx::query("UPDATE teams SET name = $1 WHERE id = $2")
            .bind(&name)
            .bind(team_id)
            .execute(&pool)
            .await
        {
            tracing::error!(error = %e, "update team name failed");
            return server_error("updateTeam");
        }
    }
    if let Some(desc) = body.description.as_ref() {
        let trimmed = desc.trim().to_string();
        if trimmed.chars().count() > DESC_MAX {
            return bad_request("descriptionTooLong");
        }
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed) };
        if let Err(e) = sqlx::query("UPDATE teams SET description = $1 WHERE id = $2")
            .bind(value.as_deref())
            .bind(team_id)
            .execute(&pool)
            .await
        {
            tracing::error!(error = %e, "update team description failed");
            return server_error("updateTeam");
        }
    }

    ok_response()
}

pub async fn delete_team(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if !is_org_admin(&role) {
        return forbidden("forbidden");
    }

    let res = sqlx::query("DELETE FROM teams WHERE org_id = $1 AND slug = $2")
        .bind(org_id)
        .bind(&team_slug)
        .execute(&pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() == 0 => not_found("teamNotFound"),
        Ok(_) => ok_response(),
        Err(e) => {
            tracing::error!(error = %e, "delete team failed");
            server_error("deleteTeam")
        }
    }
}

// ---------- team members ----------

pub async fn list_team_members(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, _role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };

    let team_id = match resolve_team(&pool, org_id, &team_slug).await {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };

    let rows: Vec<TeamMemberRow> = sqlx::query_as(
        "SELECT tm.user_id, u.email, tm.role, tm.created_at \
         FROM team_memberships tm JOIN users u ON u.id = tm.user_id \
         WHERE tm.team_id = $1 ORDER BY tm.created_at",
    )
    .bind(team_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddTeamMemberBody {
    pub user_id: Uuid,
    pub role: String,
}

pub async fn add_team_member(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug)): Path<(String, String)>,
    Json(body): Json<AddTeamMemberBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };

    let team_id = match resolve_team(&pool, org_id, &team_slug).await {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };

    // org owner/admin always allowed; team lead allowed for their own team.
    if !(is_org_admin(&role) || is_team_lead(&pool, team_id, user.id).await) {
        return forbidden("forbidden");
    }

    if !VALID_TEAM_ROLES.contains(&body.role.as_str()) {
        return bad_request("invalidRole");
    }

    // Target user must already be a member of the org.
    let in_org: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2)",
    )
    .bind(org_id)
    .bind(body.user_id)
    .fetch_one(&pool)
    .await
    .unwrap_or(false);
    if !in_org {
        return bad_request("userNotInOrg");
    }

    let res = sqlx::query(
        "INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role",
    )
    .bind(team_id)
    .bind(body.user_id)
    .bind(&body.role)
    .execute(&pool)
    .await;

    if let Err(e) = res {
        tracing::error!(error = %e, "insert team member failed");
        return server_error("insertTeamMember");
    }

    (StatusCode::CREATED, Json(json!({ "ok": true }))).into_response()
}

#[derive(Deserialize)]
pub struct PatchTeamMemberBody {
    pub role: String,
}

pub async fn patch_team_member(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug, target_id)): Path<(String, String, Uuid)>,
    Json(body): Json<PatchTeamMemberBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    let team_id = match resolve_team(&pool, org_id, &team_slug).await {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };
    if !(is_org_admin(&role) || is_team_lead(&pool, team_id, user.id).await) {
        return forbidden("forbidden");
    }
    if !VALID_TEAM_ROLES.contains(&body.role.as_str()) {
        return bad_request("invalidRole");
    }

    let res = sqlx::query(
        "UPDATE team_memberships SET role = $1 WHERE team_id = $2 AND user_id = $3",
    )
    .bind(&body.role)
    .bind(team_id)
    .bind(target_id)
    .execute(&pool)
    .await;

    match res {
        Ok(r) if r.rows_affected() == 0 => not_found("memberNotFound"),
        Ok(_) => ok_response(),
        Err(e) => {
            tracing::error!(error = %e, "update team member role failed");
            server_error("updateTeamMember")
        }
    }
}

pub async fn remove_team_member(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug, target_id)): Path<(String, String, Uuid)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    let team_id = match resolve_team(&pool, org_id, &team_slug).await {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };

    // Allow self-leave; otherwise require org-admin or team-lead.
    let is_self = user.id == target_id;
    if !(is_self
        || is_org_admin(&role)
        || is_team_lead(&pool, team_id, user.id).await)
    {
        return forbidden("forbidden");
    }

    let res = sqlx::query(
        "DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2",
    )
    .bind(team_id)
    .bind(target_id)
    .execute(&pool)
    .await;

    match res {
        Ok(r) if r.rows_affected() == 0 => not_found("memberNotFound"),
        Ok(_) => ok_response(),
        Err(e) => {
            tracing::error!(error = %e, "delete team member failed");
            server_error("deleteTeamMember")
        }
    }
}

// ---------- project ↔ team binding (admin router) ----------

pub async fn list_team_projects(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, team_slug)): Path<(String, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, _role) = match resolve_membership(&pool, &org_slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    let team_id = match resolve_team(&pool, org_id, &team_slug).await {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };

    let rows: Vec<ProjectRow> = sqlx::query_as(
        "SELECT p.id, p.name, p.created_at \
         FROM projects p JOIN project_teams pt ON pt.project_id = p.id \
         WHERE pt.team_id = $1 ORDER BY p.created_at",
    )
    .bind(team_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

/// POST /admin/api/projects/{project_id}/teams/{team_slug}
/// Bind a project to a team. Caller must be org owner/admin of the project's org.
pub async fn assign_project_to_team(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, team_slug)): Path<(Uuid, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, _project_name) = match project_org(&pool, project_id).await {
        Some(v) => v,
        None => return not_found("projectNotFound"),
    };

    if !caller_is_org_admin(&pool, &caller, org_id).await {
        return forbidden("forbidden");
    }

    let team_id = match resolve_team(&pool, org_id, &team_slug).await {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };

    let res = sqlx::query(
        "INSERT INTO project_teams (project_id, team_id) VALUES ($1, $2) \
         ON CONFLICT (project_id, team_id) DO NOTHING",
    )
    .bind(project_id)
    .bind(team_id)
    .execute(&pool)
    .await;

    if let Err(e) = res {
        tracing::error!(error = %e, "bind project to team failed");
        return server_error("bindProjectTeam");
    }

    (StatusCode::CREATED, Json(json!({ "ok": true }))).into_response()
}

/// DELETE /admin/api/projects/{project_id}/teams/{team_slug}
pub async fn unassign_project_from_team(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, team_slug)): Path<(Uuid, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, _project_name) = match project_org(&pool, project_id).await {
        Some(v) => v,
        None => return not_found("projectNotFound"),
    };

    if !caller_is_org_admin(&pool, &caller, org_id).await {
        return forbidden("forbidden");
    }

    let team_id = match resolve_team(&pool, org_id, &team_slug).await {
        Some(id) => id,
        None => return not_found("teamNotFound"),
    };

    let res = sqlx::query(
        "DELETE FROM project_teams WHERE project_id = $1 AND team_id = $2",
    )
    .bind(project_id)
    .bind(team_id)
    .execute(&pool)
    .await;

    match res {
        Ok(_) => ok_response(),
        Err(e) => {
            tracing::error!(error = %e, "unbind project from team failed");
            server_error("unbindProjectTeam")
        }
    }
}

/// GET /admin/api/projects/{project_id}/teams
pub async fn list_project_teams(
    State(state): State<AppState>,
    Extension(_caller): Extension<AdminCaller>,
    Path(project_id): Path<Uuid>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let rows: Vec<TeamRow> = sqlx::query_as(
        "SELECT t.id, t.org_id, t.slug, t.name, t.description, t.created_at \
         FROM teams t JOIN project_teams pt ON pt.team_id = t.id \
         WHERE pt.project_id = $1 ORDER BY t.created_at",
    )
    .bind(project_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

// ---------- helpers ----------

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
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT org_id, name FROM projects WHERE id = $1",
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

async fn is_team_lead(pool: &PgPool, team_id: Uuid, user_id: Uuid) -> bool {
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

fn is_org_admin(role: &str) -> bool {
    matches!(role, "owner" | "admin")
}

async fn caller_is_org_admin(pool: &PgPool, caller: &AdminCaller, org_id: Uuid) -> bool {
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

fn is_valid_slug(s: &str) -> bool {
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

fn is_valid_name(s: &str) -> bool {
    let len = s.chars().count();
    len >= NAME_MIN && len <= NAME_MAX
}

fn ok_response() -> Response {
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

fn conflict(error: &str) -> Response {
    (StatusCode::CONFLICT, Json(json!({ "error": error }))).into_response()
}

fn forbidden(error: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": error }))).into_response()
}

fn not_found(error: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": error }))).into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
