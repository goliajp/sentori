// Project ↔ team binding (admin router).
//
// v1.1 P2 split-out of `api/teams.rs`. Re-exported from
// `api/teams/mod.rs`.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use uuid::Uuid;

use super::{
    actor_user_id, caller_is_org_admin, forbidden, not_found, ok_response, project_org,
    resolve_membership, resolve_team, server_error, ProjectRow, TeamRow,
};
use crate::api::admin_auth::AdminCaller;
use crate::api::user_auth::CurrentUser;
use crate::audit::{actions, targets};
use crate::recent::AppState;

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

    crate::audit::record(
        &pool,
        org_id,
        actor_user_id(&caller),
        actions::PROJECT_TEAM_BOUND,
        targets::PROJECT_TEAM,
        Some(project_id),
        json!({ "team_slug": team_slug }),
    )
    .await;

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

    let res = sqlx::query("DELETE FROM project_teams WHERE project_id = $1 AND team_id = $2")
        .bind(project_id)
        .bind(team_id)
        .execute(&pool)
        .await;

    match res {
        Ok(_) => {
            crate::audit::record(
                &pool,
                org_id,
                actor_user_id(&caller),
                actions::PROJECT_TEAM_UNBOUND,
                targets::PROJECT_TEAM,
                Some(project_id),
                json!({ "team_slug": team_slug }),
            )
            .await;
            ok_response()
        }
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
