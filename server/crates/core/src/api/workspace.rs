// Phase A.1 Stage B-3c — workspace API module skeleton.
//
// 替代 api/orgs/members.rs (per §08 identity 重整)。 v0.1 endpoint:
//   GET    /api/workspace                          → workspace overview
//   GET    /api/workspace/members                  → list workspace_members
//   POST   /api/workspace/members                  → invite (workspace_invites)
//   PATCH  /api/workspace/members/{user_id}        → 改 role (owner only for admin↔user)
//   DELETE /api/workspace/members/{user_id}        → kick (owner/admin)
//   POST   /api/workspace/transfer                 → 单边 owner transfer (only owner)
//   GET    /api/workspace/invites                  → list pending invites
//   DELETE /api/workspace/invites/{token}          → revoke pending invite
//   POST   /api/invites/{token}/accept             → accept invite (匿名 + 设密码)
//
//   GET    /api/projects/{id}/users                → list visible users (owner/admin see all)
//   POST   /api/projects/{id}/users/{user_id}      → grant project visibility (owner/admin)
//   DELETE /api/projects/{id}/users/{user_id}      → revoke visibility
//
// Stage B-3c skeleton — endpoint signature 占位, body 用 todo!() / 简单 stub。
// Stage B-3d+ 真接 sqlx + 业务逻辑。

#![allow(dead_code, unused_imports, unused_variables)]

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

// ── Schema types (mirrors crates/core/migrations/0083_workspace_v2.sql) ──

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceMember {
    pub user_id: Uuid,
    pub email: String,
    pub role: WorkspaceRole,
    pub added_by: Option<Uuid>,
    pub added_at: time::OffsetDateTime,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceRole {
    Owner,
    Admin,
    User,
}

impl WorkspaceRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::User => "user",
        }
    }
    pub fn can_manage_members(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }
    pub fn can_grant_admin(self) -> bool {
        matches!(self, Self::Owner)
    }
    pub fn can_manage_projects(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }
    pub fn auto_visible_to_all_projects(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectUserVisibility {
    pub project_id: Uuid,
    pub user_id: Uuid,
    pub granted_by: Option<Uuid>,
    pub granted_at: time::OffsetDateTime,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceInvite {
    pub id: Uuid,
    pub email: String,
    pub role: WorkspaceRole,
    pub invited_by: Uuid,
    pub expires_at: time::OffsetDateTime,
    pub accepted_at: Option<time::OffsetDateTime>,
}

// ── Handler stubs (B-3d+ 真接) ──

pub async fn list_members(State(_pool): State<PgPool>) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn invite_member(State(_pool): State<PgPool>) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn patch_member(
    State(_pool): State<PgPool>,
    Path(_user_id): Path<Uuid>,
) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn kick_member(
    State(_pool): State<PgPool>,
    Path(_user_id): Path<Uuid>,
) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn transfer_owner(State(_pool): State<PgPool>) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn list_invites(State(_pool): State<PgPool>) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn revoke_invite(
    State(_pool): State<PgPool>,
    Path(_token): Path<String>,
) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn accept_invite(
    State(_pool): State<PgPool>,
    Path(_token): Path<String>,
) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

// ── Project visibility handlers ──

pub async fn list_project_users(
    State(_pool): State<PgPool>,
    Path(_project_id): Path<Uuid>,
) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn grant_project_visibility(
    State(_pool): State<PgPool>,
    Path((_project_id, _user_id)): Path<(Uuid, Uuid)>,
) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}

pub async fn revoke_project_visibility(
    State(_pool): State<PgPool>,
    Path((_project_id, _user_id)): Path<(Uuid, Uuid)>,
) -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "B-3d todo")
}
