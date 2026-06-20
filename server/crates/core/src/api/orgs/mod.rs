// Phase 13 sub-section C: orgs / memberships / invites / transfers /
// audit / activity. All endpoints require an authenticated session.
//
// v1.1 P2: split out of the 1524-LOC `api/orgs.rs` into logical
// sub-files. Public surface preserved via re-exports so the router
// keeps calling `api::orgs::create_org`, etc.

use axum::{
    extract::Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

// ── constants ──────────────────────────────────────────────────────────

pub(super) const INVITE_TTL_DAYS: i64 = 7;
pub(super) const TRANSFER_TTL_DAYS: i64 = 7;
pub(super) const SLUG_MIN: usize = 3;
pub(super) const SLUG_MAX: usize = 32;
pub(super) const NAME_MIN: usize = 1;
pub(super) const NAME_MAX: usize = 64;

// ── shared response shapes ─────────────────────────────────────────────

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct OrgRow {
    pub(super) id: Uuid,
    pub(super) slug: String,
    pub(super) name: String,
    pub(super) owner_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub(super) created_at: OffsetDateTime,
    pub(super) role: String,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct MemberRow {
    pub(super) user_id: Uuid,
    pub(super) email: String,
    pub(super) role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub(super) created_at: OffsetDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub(super) struct InviteRow {
    pub(super) token: String,
    pub(super) email: String,
    pub(super) role: String,
    #[serde(with = "time::serde::rfc3339")]
    pub(super) expires_at: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub(super) used_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub(super) created_at: OffsetDateTime,
    pub(super) team_slug: Option<String>,
}

// ── shared helpers ─────────────────────────────────────────────────────

pub(super) async fn resolve_membership(
    pool: &PgPool,
    slug: &str,
    user_id: Uuid,
) -> Option<(Uuid, String)> {
    sqlx::query_as::<_, (Uuid, String)>(
        "SELECT o.id, m.role FROM orgs o \
         JOIN memberships m ON m.org_id = o.id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(slug)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

pub(super) fn is_valid_slug(s: &str) -> bool {
    let len = s.len();
    if len < SLUG_MIN || len > SLUG_MAX {
        return false;
    }
    if s.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub(super) fn is_valid_name(s: &str) -> bool {
    let len = s.chars().count();
    len >= NAME_MIN && len <= NAME_MAX
}

pub(super) fn ok_response() -> Response {
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

pub(super) fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

pub(super) fn conflict(error: &str) -> Response {
    (StatusCode::CONFLICT, Json(json!({ "error": error }))).into_response()
}

pub(super) fn forbidden(error: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": error }))).into_response()
}

pub(super) fn not_found(error: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": error }))).into_response()
}

pub(super) fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}

// ── sub-modules + re-exports ───────────────────────────────────────────

mod audit;
mod crud;
mod gdpr;
mod invites;
mod members;
mod transfer;

pub use audit::{
    list_audit, list_audit_actions, list_my_activity, AuditQuery, UserActivityQuery,
};
pub use crud::{create_org, delete_org, get_org, list_my_orgs, patch_org, CreateOrgBody, PatchOrgBody};
pub use gdpr::{export_org, org_usage};
pub use invites::{accept_invite, create_invite, delete_invite, list_invites, CreateInviteBody};
pub use members::{delete_member, list_members, patch_member, PatchMemberBody};
pub use transfer::{accept_transfer, create_transfer, CreateTransferBody};
