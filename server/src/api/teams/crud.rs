// Team CRUD — list / create / get / patch / delete.
//
// v1.1 P2 split-out of `api/teams.rs`. Re-exported from
// `api/teams/mod.rs` so external callers continue to use
// `api::teams::create_team` etc.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use super::{
    bad_request, conflict, forbidden, is_org_admin, is_valid_name, is_valid_slug, not_found,
    ok_response, resolve_membership, server_error, TeamRow, DESC_MAX,
};
use crate::api::user_auth::CurrentUser;
use crate::audit::{actions, targets};
use crate::recent::AppState;

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

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        actions::TEAM_CREATED,
        targets::TEAM,
        Some(team_id),
        json!({ "slug": team_slug, "name": name }),
    )
    .await;

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

    let team_id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM teams WHERE org_id = $1 AND slug = $2")
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

    let team_id_for_audit: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM teams WHERE org_id = $1 AND slug = $2")
            .bind(org_id)
            .bind(&team_slug)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();

    let res = sqlx::query("DELETE FROM teams WHERE org_id = $1 AND slug = $2")
        .bind(org_id)
        .bind(&team_slug)
        .execute(&pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() == 0 => not_found("teamNotFound"),
        Ok(_) => {
            crate::audit::record(
                &pool,
                org_id,
                Some(user.id),
                actions::TEAM_DELETED,
                targets::TEAM,
                team_id_for_audit,
                json!({ "slug": team_slug }),
            )
            .await;
            ok_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "delete team failed");
            server_error("deleteTeam")
        }
    }
}
