// Org invites — create / list / delete / accept.
//
// v1.1 P2 split-out of `api/orgs.rs`.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{
    bad_request, forbidden, not_found, ok_response, resolve_membership, server_error, InviteRow,
    INVITE_TTL_DAYS,
};
use crate::api::user_auth::{is_plausible_email, random_token, CurrentUser};
use crate::notifier::NotifyEvent;
use crate::recent::AppState;
use crate::roles::VALID_INVITE_ROLES;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInviteBody {
    pub email: String,
    pub role: String,
    pub team_slug: Option<String>,
}

pub async fn create_invite(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateInviteBody>,
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

    let email = body.email.trim().to_ascii_lowercase();
    if !is_plausible_email(&email) {
        return bad_request("invalidEmail");
    }
    if !VALID_INVITE_ROLES.contains(&body.role.as_str()) {
        return bad_request("invalidRole");
    }

    let team_id: Option<Uuid> = if let Some(team_slug) = body.team_slug.as_ref() {
        let s = team_slug.trim();
        if s.is_empty() {
            None
        } else {
            let id: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM teams WHERE org_id = $1 AND slug = $2")
                    .bind(org_id)
                    .bind(s)
                    .fetch_optional(&pool)
                    .await
                    .ok()
                    .flatten();
            match id {
                Some(id) => Some(id),
                None => return bad_request("teamNotFound"),
            }
        }
    } else {
        None
    };

    let token = random_token(32);
    let expires_at = OffsetDateTime::now_utc() + Duration::days(INVITE_TTL_DAYS);

    if let Err(e) = sqlx::query(
        "INSERT INTO org_invites (token, org_id, email, role, expires_at, team_id) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(&token)
    .bind(org_id)
    .bind(&email)
    .bind(&body.role)
    .bind(expires_at)
    .bind(team_id)
    .execute(&pool)
    .await
    {
        tracing::error!(error = %e, "insert invite failed");
        return server_error("insertInvite");
    }

    if let Some(tx) = &state.notifier_tx {
        let org_name: String = sqlx::query_scalar("SELECT name FROM orgs WHERE id = $1")
            .bind(org_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| slug.clone());
        let link = format!(
            "{}/invite/{}",
            state.base_url.trim_end_matches('/'),
            token
        );
        let _ = tx.try_send(NotifyEvent::OrgInvite {
            email: email.clone(),
            org_name,
            inviter_email: user.email.clone(),
            link,
        });
    }

    (StatusCode::CREATED, Json(json!({ "token": token }))).into_response()
}

pub async fn list_invites(
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
    if !matches!(role.as_str(), "owner" | "admin") {
        return forbidden("forbidden");
    }

    let rows: Vec<InviteRow> = sqlx::query_as(
        "SELECT i.token, i.email, i.role, i.expires_at, i.used_at, i.created_at, t.slug AS team_slug \
         FROM org_invites i LEFT JOIN teams t ON t.id = i.team_id \
         WHERE i.org_id = $1 AND i.used_at IS NULL \
         ORDER BY i.created_at DESC",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

pub async fn delete_invite(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((slug, token)): Path<(String, String)>,
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

    let res = sqlx::query("DELETE FROM org_invites WHERE token = $1 AND org_id = $2")
        .bind(&token)
        .bind(org_id)
        .execute(&pool)
        .await;

    match res {
        Ok(r) if r.rows_affected() == 0 => not_found("inviteNotFound"),
        Ok(_) => ok_response(),
        Err(e) => {
            tracing::error!(error = %e, "delete invite failed");
            server_error("deleteInvite")
        }
    }
}

pub async fn accept_invite(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(token): Path<String>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let row: Option<(
        Uuid,
        String,
        String,
        OffsetDateTime,
        Option<OffsetDateTime>,
        Option<Uuid>,
    )> = sqlx::query_as(
        "SELECT org_id, email, role, expires_at, used_at, team_id \
         FROM org_invites WHERE token = $1",
    )
    .bind(&token)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let (org_id, invite_email, role, expires_at, used_at, team_id) = match row {
        Some(r) => r,
        None => return not_found("inviteNotFound"),
    };
    if used_at.is_some() {
        return bad_request("inviteUsed");
    }
    if expires_at < OffsetDateTime::now_utc() {
        return bad_request("inviteExpired");
    }
    if invite_email.to_ascii_lowercase() != user.email.to_ascii_lowercase() {
        return forbidden("inviteEmailMismatch");
    }

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(_) => return server_error("tx"),
    };

    let insert = sqlx::query(
        "INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (org_id, user_id) DO NOTHING",
    )
    .bind(org_id)
    .bind(user.id)
    .bind(&role)
    .execute(&mut *tx)
    .await;
    if let Err(e) = insert {
        tracing::error!(error = %e, "insert membership failed");
        return server_error("insertMembership");
    }

    if let Some(tid) = team_id {
        if let Err(e) = sqlx::query(
            "INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'member') \
             ON CONFLICT (team_id, user_id) DO NOTHING",
        )
        .bind(tid)
        .bind(user.id)
        .execute(&mut *tx)
        .await
        {
            tracing::error!(error = %e, "insert team membership failed");
            return server_error("insertTeamMembership");
        }
    }

    if let Err(e) = sqlx::query("UPDATE org_invites SET used_at = now() WHERE token = $1")
        .bind(&token)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, "mark invite used failed");
        return server_error("markInviteUsed");
    }

    if tx.commit().await.is_err() {
        return server_error("commitTx");
    }

    let slug: String = sqlx::query_scalar("SELECT slug FROM orgs WHERE id = $1")
        .bind(org_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_default();

    (
        StatusCode::OK,
        Json(json!({ "ok": true, "orgSlug": slug })),
    )
        .into_response()
}
