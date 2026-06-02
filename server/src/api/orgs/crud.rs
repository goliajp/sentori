// Org CRUD — create / list / get / patch / delete.
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
    bad_request, conflict, forbidden, is_valid_name, is_valid_slug, not_found, ok_response,
    resolve_membership, server_error, OrgRow,
};
use crate::api::user_auth::CurrentUser;
use crate::audit::{actions, targets};
use crate::recent::AppState;

#[derive(Deserialize)]
pub struct CreateOrgBody {
    pub slug: String,
    pub name: String,
}

pub async fn create_org(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(body): Json<CreateOrgBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let slug = body.slug.trim().to_ascii_lowercase();
    if !is_valid_slug(&slug) {
        return bad_request("invalidSlug");
    }
    let name = body.name.trim().to_string();
    if !is_valid_name(&name) {
        return bad_request("invalidName");
    }

    let org_id = Uuid::now_v7();
    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(error = %e, "begin tx failed");
            return server_error("tx");
        }
    };

    let insert_org = sqlx::query("INSERT INTO orgs (id, slug, name, owner_id) VALUES ($1, $2, $3, $4)")
        .bind(org_id)
        .bind(&slug)
        .bind(&name)
        .bind(user.id)
        .execute(&mut *tx)
        .await;

    if let Err(e) = insert_org {
        if let sqlx::Error::Database(db_err) = &e
            && db_err.is_unique_violation()
        {
            return conflict("slugTaken");
        }
        tracing::error!(error = %e, "insert org failed");
        return server_error("insertOrg");
    }

    let insert_member =
        sqlx::query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')")
            .bind(org_id)
            .bind(user.id)
            .execute(&mut *tx)
            .await;

    if let Err(e) = insert_member {
        tracing::error!(error = %e, "insert owner membership failed");
        return server_error("insertMembership");
    }

    if let Err(e) = crate::quotas::ensure_default_quota(&mut *tx, org_id).await {
        tracing::error!(error = %e, "insert default quota failed");
        return server_error("insertQuota");
    }

    if tx.commit().await.is_err() {
        return server_error("commitTx");
    }

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        actions::ORG_CREATED,
        targets::ORG,
        Some(org_id),
        json!({ "slug": slug, "name": name }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({
            "id": org_id, "slug": slug, "name": name, "role": "owner",
        })),
    )
        .into_response()
}

pub async fn list_my_orgs(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let rows: Vec<OrgRow> = match sqlx::query_as(
        "SELECT o.id, o.slug, o.name, o.owner_id, o.created_at, m.role \
         FROM orgs o JOIN memberships m ON m.org_id = o.id \
         WHERE m.user_id = $1 ORDER BY o.created_at DESC",
    )
    .bind(user.id)
    .fetch_all(&pool)
    .await
    {
        Ok(rs) => rs,
        Err(e) => {
            tracing::error!(error = %e, "list orgs failed");
            return server_error("listOrgs");
        }
    };

    (StatusCode::OK, Json(rows)).into_response()
}

pub async fn get_org(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let row: Option<OrgRow> = sqlx::query_as(
        "SELECT o.id, o.slug, o.name, o.owner_id, o.created_at, m.role \
         FROM orgs o JOIN memberships m ON m.org_id = o.id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(&slug)
    .bind(user.id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    match row {
        Some(r) => (StatusCode::OK, Json(r)).into_response(),
        None => not_found("orgNotFound"),
    }
}

#[derive(Deserialize)]
pub struct PatchOrgBody {
    pub name: Option<String>,
}

pub async fn patch_org(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<PatchOrgBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return forbidden("forbidden");
    }

    if let Some(name) = body.name.as_ref().map(|s| s.trim().to_string()) {
        if !is_valid_name(&name) {
            return bad_request("invalidName");
        }
        if let Err(e) = sqlx::query("UPDATE orgs SET name = $1 WHERE id = $2")
            .bind(&name)
            .bind(org_id)
            .execute(&pool)
            .await
        {
            tracing::error!(error = %e, "update org name failed");
            return server_error("updateOrg");
        }
        crate::audit::record(
            &pool,
            org_id,
            Some(user.id),
            actions::ORG_PATCHED,
            targets::ORG,
            Some(org_id),
            json!({ "name": name }),
        )
        .await;
    }

    ok_response()
}

pub async fn delete_org(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
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

    let org_name: String = sqlx::query_scalar("SELECT name FROM orgs WHERE id = $1")
        .bind(org_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_default();
    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        actions::ORG_DELETED,
        targets::ORG,
        Some(org_id),
        json!({ "slug": slug, "name": org_name }),
    )
    .await;

    if let Err(e) = sqlx::query("DELETE FROM orgs WHERE id = $1")
        .bind(org_id)
        .execute(&pool)
        .await
    {
        tracing::error!(error = %e, "delete org failed");
        return server_error("deleteOrg");
    }

    ok_response()
}
