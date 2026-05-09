// Phase 13 sub-section C: orgs / memberships / invites.
// All endpoints require an authenticated session (mounted under
// `require_user` in router.rs). Per-endpoint role checks gate writes:
//   - `owner`           : can do everything
//   - `owner` | `admin` : can invite, can remove non-owner members
//   - `member`          : can read, can leave (DELETE self)
// Slug rules: 3–32 chars, [a-z0-9-], not purely numeric.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::api::user_auth::{CurrentUser, is_plausible_email, random_token};
use crate::notifier::NotifyEvent;
use crate::recent::AppState;

const INVITE_TTL_DAYS: i64 = 7;
const SLUG_MIN: usize = 3;
const SLUG_MAX: usize = 32;
const NAME_MIN: usize = 1;
const NAME_MAX: usize = 64;
const VALID_ROLES: &[&str] = &["owner", "admin", "member"];

// ---------- response shapes ----------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct OrgRow {
    id: Uuid,
    slug: String,
    name: String,
    owner_id: Uuid,
    created_at: OffsetDateTime,
    role: String,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct MemberRow {
    user_id: Uuid,
    email: String,
    role: String,
    created_at: OffsetDateTime,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct InviteRow {
    token: String,
    email: String,
    role: String,
    expires_at: OffsetDateTime,
    used_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

// ---------- org CRUD ----------

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

    let insert_org = sqlx::query(
        "INSERT INTO orgs (id, slug, name, owner_id) VALUES ($1, $2, $3, $4)",
    )
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

    let insert_member = sqlx::query(
        "INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')",
    )
    .bind(org_id)
    .bind(user.id)
    .execute(&mut *tx)
    .await;

    if let Err(e) = insert_member {
        tracing::error!(error = %e, "insert owner membership failed");
        return server_error("insertMembership");
    }

    if tx.commit().await.is_err() {
        return server_error("commitTx");
    }

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

// ---------- memberships ----------

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

    if !VALID_ROLES.contains(&body.role.as_str()) {
        return bad_request("invalidRole");
    }
    if user.id == target_id && body.role != "owner" {
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
        Ok(_) => ok_response(),
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

    // Allow self-leave even for non-admin members; otherwise require admin/owner.
    let is_self = user.id == target_id;
    let allowed = is_self || matches!(role.as_str(), "owner" | "admin");
    if !allowed {
        return forbidden("forbidden");
    }

    // Block removing the last owner — would orphan the org.
    let target_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2",
    )
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

    ok_response()
}

// ---------- invites ----------

#[derive(Deserialize)]
pub struct CreateInviteBody {
    pub email: String,
    pub role: String,
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
    if !VALID_ROLES.contains(&body.role.as_str()) {
        return bad_request("invalidRole");
    }
    if body.role == "owner" {
        // Inviting someone as a co-owner is intentionally not exposed via
        // this endpoint — promote them to owner via PATCH after they join.
        return bad_request("cannotInviteAsOwner");
    }

    let token = random_token(32);
    let expires_at = OffsetDateTime::now_utc() + Duration::days(INVITE_TTL_DAYS);

    if let Err(e) = sqlx::query(
        "INSERT INTO org_invites (token, org_id, email, role, expires_at) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&token)
    .bind(org_id)
    .bind(&email)
    .bind(&body.role)
    .bind(expires_at)
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
        "SELECT token, email, role, expires_at, used_at, created_at \
         FROM org_invites WHERE org_id = $1 AND used_at IS NULL \
         ORDER BY created_at DESC",
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

    let row: Option<(Uuid, String, String, OffsetDateTime, Option<OffsetDateTime>)> =
        sqlx::query_as(
            "SELECT org_id, email, role, expires_at, used_at \
             FROM org_invites WHERE token = $1",
        )
        .bind(&token)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();

    let (org_id, invite_email, role, expires_at, used_at) = match row {
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

// ---------- helpers ----------

async fn resolve_membership(pool: &PgPool, slug: &str, user_id: Uuid) -> Option<(Uuid, String)> {
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

fn is_valid_slug(s: &str) -> bool {
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

fn is_valid_name(s: &str) -> bool {
    let len = s.chars().count();
    len >= NAME_MIN && len <= NAME_MAX
}

fn ok_response() -> Response {
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

fn conflict(error: &str) -> Response {
    (StatusCode::CONFLICT, Json(json!({ "error": error }))).into_response()
}

fn forbidden(error: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": error }))).into_response()
}

fn not_found(error: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": error }))).into_response()
}

fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
