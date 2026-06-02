// Org membership — list / patch / remove.
//
// v1.1 P2 split-out of `api/orgs.rs`.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use super::{
    bad_request, forbidden, not_found, ok_response, resolve_membership, server_error, MemberRow,
};
use crate::api::user_auth::CurrentUser;
use crate::audit::{actions, targets};
use crate::recent::AppState;
use crate::roles::VALID_MEMBER_PATCH_ROLES;

pub async fn list_members(
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

    let rows: Vec<MemberRow> = sqlx::query_as(
        "SELECT m.user_id, u.email, m.role, m.created_at \
         FROM memberships m JOIN users u ON u.id = m.user_id \
         WHERE m.org_id = $1 ORDER BY m.created_at",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
pub struct PatchMemberBody {
    pub role: String,
}

pub async fn patch_member(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((slug, target_id)): Path<(String, Uuid)>,
    Json(body): Json<PatchMemberBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if role != "owner" {
        return forbidden("forbidden");
    }

    if !VALID_MEMBER_PATCH_ROLES.contains(&body.role.as_str()) {
        return bad_request("invalidRole");
    }
    if user.id == target_id {
        return bad_request("cannotDemoteSelf");
    }

    let res = sqlx::query("UPDATE memberships SET role = $1 WHERE org_id = $2 AND user_id = $3")
        .bind(&body.role)
        .bind(org_id)
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
                actions::MEMBER_ROLE_PATCHED,
                targets::MEMBER,
                Some(target_id),
                json!({ "role": body.role }),
            )
            .await;
            ok_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "patch member failed");
            server_error("updateMembership")
        }
    }
}

pub async fn delete_member(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((slug, target_id)): Path<(String, Uuid)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };

    let is_self = user.id == target_id;
    let allowed = is_self || matches!(role.as_str(), "owner" | "admin");
    if !allowed {
        return forbidden("forbidden");
    }

    let target_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2")
            .bind(org_id)
            .bind(target_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    let target_role = match target_role {
        Some(r) => r,
        None => return not_found("memberNotFound"),
    };
    if target_role == "owner" {
        let owner_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM memberships WHERE org_id = $1 AND role = 'owner'",
        )
        .bind(org_id)
        .fetch_one(&pool)
        .await
        .unwrap_or(0);
        if owner_count <= 1 {
            return bad_request("lastOwner");
        }
    }

    if let Err(e) = sqlx::query("DELETE FROM memberships WHERE org_id = $1 AND user_id = $2")
        .bind(org_id)
        .bind(target_id)
        .execute(&pool)
        .await
    {
        tracing::error!(error = %e, "delete member failed");
        return server_error("deleteMembership");
    }

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        actions::MEMBER_REMOVED,
        targets::MEMBER,
        Some(target_id),
        json!({ "self_leave": is_self }),
    )
    .await;

    ok_response()
}
