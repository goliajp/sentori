//! Workspace member admin endpoints:
//!
//! - `GET    /admin/api/members` — list workspace members
//! - `PATCH  /admin/api/members/:user_id` — change role
//! - `DELETE /admin/api/members/:user_id` — remove from workspace
//!
//! Owner transfer is intentionally a separate endpoint (see
//! `POST /admin/api/transfer-owner`) because it's not a simple
//! role-set — it's an atomic two-row swap.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use sentori_workspace_identity::{Role, UserId};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::{info, warn};
use uuid::Uuid;

use crate::state::AppState;

pub async fn list(State(state): State<Arc<AppState>>) -> Json<Value> {
    match state.identity.members().list().await {
        Ok(members) => {
            let out: Vec<Value> = members
                .iter()
                .map(|m| {
                    json!({
                        "user_id": m.user_id.to_string(),
                        "role": role_str(m.role),
                        "added_by": m.added_by.map(|u| u.to_string()),
                        "added_at": m.added_at,
                    })
                })
                .collect();
            Json(json!({ "members": out }))
        }
        Err(e) => {
            warn!(error = %e, "admin.members list_failed");
            Json(json!({ "members": [], "error": "internal" }))
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBody {
    pub role: String,
}

pub async fn update_role(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
    Json(body): Json<UpdateBody>,
) -> (StatusCode, Json<Value>) {
    let role = match body.role.as_str() {
        "admin" => Role::Admin,
        "user" => Role::User,
        "owner" => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "use /admin/api/transfer-owner to grant owner" })),
            );
        }
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_role" })),
            );
        }
    };

    let uid = UserId::from_uuid(user_id);
    match state.identity.members().set_role(uid, role).await {
        Ok(()) => {
            info!(%user_id, ?role, "admin.members role_changed");
            (
                StatusCode::OK,
                Json(json!({ "user_id": user_id.to_string(), "role": body.role })),
            )
        }
        Err(e) => {
            warn!(error = %e, "admin.members update_failed");
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            )
        }
    }
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(user_id): Path<Uuid>) -> StatusCode {
    let uid = UserId::from_uuid(user_id);
    match state.identity.members().remove(uid).await {
        Ok(()) => {
            info!(%user_id, "admin.members removed");
            crate::notify::audit(
                &state.pool,
                state.workspace_id.into_uuid(),
                None,
                None,
                "member.remove",
                Some("user"),
                Some(&user_id.to_string()),
                serde_json::json!({}),
            )
            .await;
            StatusCode::NO_CONTENT
        }
        Err(e) => {
            warn!(error = %e, "admin.members remove_failed");
            StatusCode::BAD_REQUEST
        }
    }
}

fn role_str(r: Role) -> &'static str {
    match r {
        Role::Owner => "owner",
        Role::Admin => "admin",
        Role::User => "user",
    }
}
