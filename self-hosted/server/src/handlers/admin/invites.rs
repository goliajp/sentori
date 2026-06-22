//! Workspace invite admin endpoints:
//!
//! - `POST   /admin/api/invites` — mint invite token
//! - `GET    /admin/api/invites` — list all (pending + accepted +
//!   expired)
//! - `DELETE /admin/api/invites/:id` — revoke pending invite
//! - `POST   /auth/invites/:token/accept` — accepted by invitee
//!   (NB: this one is auth-scoped not admin; lives in auth/)

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use sentori_workspace_identity::{InviteRole, UserId};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::{info, warn};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    pub email: String,
    pub role: String,
    /// Who's sending the invite (subject's user_id).
    pub invited_by: Uuid,
    /// Days until expiry (server-clamped to MAX_EXPIRES_IN_DAYS).
    #[serde(default = "default_expires")]
    pub expires_in_days: i64,
}

const fn default_expires() -> i64 {
    7
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBody>,
) -> (StatusCode, Json<Value>) {
    let role = match body.role.as_str() {
        "admin" => InviteRole::Admin,
        "user" => InviteRole::User,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_role" })),
            );
        }
    };
    match state
        .identity
        .invites()
        .create(
            &body.email,
            role,
            UserId::from_uuid(body.invited_by),
            body.expires_in_days,
        )
        .await
    {
        Ok(minted) => {
            info!(
                invite_id = %minted.invite.id,
                email = %body.email,
                role = %body.role,
                "admin.invites minted",
            );
            (
                StatusCode::CREATED,
                Json(json!({
                    "invite_id": minted.invite.id.to_string(),
                    "token": minted.plaintext_token.to_wire_string(),
                    "expires_at": minted.invite.expires_at,
                })),
            )
        }
        Err(e) => {
            warn!(error = %e, "admin.invites create_failed");
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            )
        }
    }
}

pub async fn list(State(state): State<Arc<AppState>>) -> Json<Value> {
    match state.identity.invites().list_all().await {
        Ok(rows) => {
            let out: Vec<Value> = rows
                .iter()
                .map(|i| {
                    json!({
                        "id": i.id.to_string(),
                        "email": i.email,
                        "role": match i.role {
                            InviteRole::Admin => "admin",
                            InviteRole::User => "user",
                        },
                        "expires_at": i.expires_at,
                        "accepted_at": i.accepted_at,
                        "created_at": i.created_at,
                    })
                })
                .collect();
            Json(json!({ "invites": out }))
        }
        Err(e) => {
            warn!(error = %e, "admin.invites list_failed");
            Json(json!({ "invites": [], "error": "internal" }))
        }
    }
}

pub async fn revoke(
    State(state): State<Arc<AppState>>,
    Path(invite_id): Path<Uuid>,
) -> StatusCode {
    match state.identity.invites().revoke(invite_id).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
