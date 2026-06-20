// Ownership transfer.
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
    bad_request, forbidden, not_found, resolve_membership, server_error, TRANSFER_TTL_DAYS,
};
use crate::api::user_auth::{random_token, CurrentUser};
use crate::audit::{actions, targets};
use crate::notifier::NotifyEvent;
use crate::recent::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferBody {
    pub to_user_id: Uuid,
}

pub async fn create_transfer(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateTransferBody>,
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
    if user.id == body.to_user_id {
        return bad_request("cannotTransferToSelf");
    }

    let target_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2")
            .bind(org_id)
            .bind(body.to_user_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    let target_role = match target_role {
        Some(r) => r,
        None => return bad_request("targetNotInOrg"),
    };
    if !matches!(target_role.as_str(), "owner" | "admin") {
        return bad_request("targetNotEligible");
    }

    let target_email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(body.to_user_id)
        .fetch_one(&pool)
        .await
        .unwrap_or_default();
    if target_email.is_empty() {
        return server_error("targetEmail");
    }

    let token = random_token(32);
    let expires_at = OffsetDateTime::now_utc() + Duration::days(TRANSFER_TTL_DAYS);
    let transfer_id = Uuid::now_v7();

    if let Err(e) = sqlx::query(
        "INSERT INTO org_ownership_transfers \
            (id, org_id, from_user_id, to_user_id, token, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(transfer_id)
    .bind(org_id)
    .bind(user.id)
    .bind(body.to_user_id)
    .bind(&token)
    .bind(expires_at)
    .execute(&pool)
    .await
    {
        tracing::error!(error = %e, "insert transfer failed");
        return server_error("insertTransfer");
    }

    if let Some(tx) = &state.notifier_tx {
        let org_name: String = sqlx::query_scalar("SELECT name FROM orgs WHERE id = $1")
            .bind(org_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| slug.clone());
        let link = format!(
            "{}/transfers/{}",
            state.base_url.trim_end_matches('/'),
            token
        );
        let _ = tx.try_send(NotifyEvent::OwnershipTransferRequested {
            to_email: target_email.clone(),
            from_email: user.email.clone(),
            org_name,
            link,
        });
    }

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        actions::ORG_TRANSFER_REQUESTED,
        targets::TRANSFER,
        Some(transfer_id),
        json!({ "to_user_id": body.to_user_id }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(json!({ "id": transfer_id, "expiresAt": expires_at })),
    )
        .into_response()
}

pub async fn accept_transfer(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(token): Path<String>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let row: Option<(Uuid, Uuid, Uuid, Uuid, OffsetDateTime, Option<OffsetDateTime>)> =
        sqlx::query_as(
            "SELECT id, org_id, from_user_id, to_user_id, expires_at, accepted_at \
             FROM org_ownership_transfers WHERE token = $1",
        )
        .bind(&token)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
    let (transfer_id, org_id, from_user_id, to_user_id, expires_at, accepted_at) = match row {
        Some(r) => r,
        None => return not_found("transferNotFound"),
    };
    if accepted_at.is_some() {
        return bad_request("transferUsed");
    }
    if expires_at < OffsetDateTime::now_utc() {
        return bad_request("transferExpired");
    }
    if user.id != to_user_id {
        return forbidden("forbidden");
    }

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(_) => return server_error("tx"),
    };

    if let Err(e) =
        sqlx::query("UPDATE memberships SET role = 'admin' WHERE org_id = $1 AND user_id = $2")
            .bind(org_id)
            .bind(from_user_id)
            .execute(&mut *tx)
            .await
    {
        tracing::error!(error = %e, "demote old owner failed");
        return server_error("demoteOldOwner");
    }

    if let Err(e) =
        sqlx::query("UPDATE memberships SET role = 'owner' WHERE org_id = $1 AND user_id = $2")
            .bind(org_id)
            .bind(to_user_id)
            .execute(&mut *tx)
            .await
    {
        tracing::error!(error = %e, "promote new owner failed");
        return server_error("promoteNewOwner");
    }

    if let Err(e) = sqlx::query("UPDATE orgs SET owner_id = $1 WHERE id = $2")
        .bind(to_user_id)
        .bind(org_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, "update orgs.owner_id failed");
        return server_error("updateOrgOwner");
    }

    if let Err(e) =
        sqlx::query("UPDATE org_ownership_transfers SET accepted_at = now() WHERE id = $1")
            .bind(transfer_id)
            .execute(&mut *tx)
            .await
    {
        tracing::error!(error = %e, "mark transfer accepted failed");
        return server_error("markAccepted");
    }

    if tx.commit().await.is_err() {
        return server_error("commitTx");
    }

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        actions::ORG_TRANSFER_ACCEPTED,
        targets::TRANSFER,
        Some(transfer_id),
        json!({ "from_user_id": from_user_id, "to_user_id": to_user_id }),
    )
    .await;

    if let Some(tx) = &state.notifier_tx {
        let old_owner_email: Option<String> =
            sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
                .bind(from_user_id)
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();
        let org_name: String = sqlx::query_scalar("SELECT name FROM orgs WHERE id = $1")
            .bind(org_id)
            .fetch_one(&pool)
            .await
            .unwrap_or_default();
        if let Some(addr) = old_owner_email {
            let _ = tx.try_send(NotifyEvent::OwnershipTransferCompleted {
                new_owner_email: user.email.clone(),
                old_owner_email: addr,
                org_name,
            });
        }
    }

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}
