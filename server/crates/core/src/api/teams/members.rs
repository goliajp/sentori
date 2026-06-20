// Team membership — list / add / patch / remove.
//
// v1.1 P2 split-out of `api/teams.rs`. Re-exported from
// `api/teams/mod.rs`.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use super::{
    bad_request, forbidden, is_org_admin, is_team_lead, not_found, ok_response,
    resolve_membership, resolve_team, server_error, TeamMemberRow,
};
use crate::api::user_auth::CurrentUser;
use crate::audit::{actions, targets};
use crate::recent::AppState;
use crate::roles::VALID_TEAM_ROLES as TEAM_ROLES;

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

    if !TEAM_ROLES.contains(&body.role.as_str()) {
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

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        actions::TEAM_MEMBER_ADDED,
        targets::TEAM_MEMBER,
        Some(body.user_id),
        json!({ "team_slug": team_slug, "role": body.role }),
    )
    .await;

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
    if !TEAM_ROLES.contains(&body.role.as_str()) {
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
    if !(is_self || is_org_admin(&role) || is_team_lead(&pool, team_id, user.id).await) {
        return forbidden("forbidden");
    }

    let res = sqlx::query("DELETE FROM team_memberships WHERE team_id = $1 AND user_id = $2")
        .bind(team_id)
        .bind(target_id)
        .execute(&pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() == 0 => not_found("memberNotFound"),
        Ok(_) => {
            crate::audit::record(
                &pool,
                org_id,
                Some(user.id),
                actions::TEAM_MEMBER_REMOVED,
                targets::TEAM_MEMBER,
                Some(target_id),
                json!({ "team_slug": team_slug, "self_leave": is_self }),
            )
            .await;
            ok_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "delete team member failed");
            server_error("deleteTeamMember")
        }
    }
}
