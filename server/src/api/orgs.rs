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
use crate::audit::{actions, targets};
use crate::notifier::NotifyEvent;
use crate::quotas;
use crate::recent::AppState;
use crate::roles::{VALID_INVITE_ROLES, VALID_MEMBER_PATCH_ROLES};

const INVITE_TTL_DAYS: i64 = 7;
const SLUG_MIN: usize = 3;
const SLUG_MAX: usize = 32;
const NAME_MIN: usize = 1;
const NAME_MAX: usize = 64;

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
    team_slug: Option<String>,
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

    if let Err(e) = sqlx::query("DELETE FROM orgs WHERE id = $1")
        .bind(org_id)
        .execute(&pool)
        .await
    {
        tracing::error!(error = %e, "delete org failed");
        return server_error("deleteOrg");
    }

    // Record into the org's audit log... after the org is gone the FK
    // cascade has already wiped the table, so this is best-effort: we
    // emit a global trace line and skip the DB row. Phase 20 will move
    // the audit log out of the org cascade so tombstones survive.
    tracing::info!(%org_id, actor = %user.id, action = actions::ORG_DELETED, "audit org delete");

    ok_response()
}

// ---------- data export (Phase 16 sub-D, GDPR) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResponse {
    org: OrgRow,
    members: Vec<MemberRow>,
    projects: Vec<ExportedProject>,
    pending_invites: Vec<InviteRow>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ExportedProject {
    id: Uuid,
    name: String,
    created_at: OffsetDateTime,
    tokens: Vec<ExportedToken>,
    recipients: Vec<ExportedRecipient>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ExportedToken {
    id: Uuid,
    kind: String,
    label: Option<String>,
    last4: Option<String>,
    created_at: OffsetDateTime,
    revoked_at: Option<OffsetDateTime>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ExportedRecipient {
    id: Uuid,
    email: String,
    on_new_issue: bool,
    on_regression: bool,
    created_at: OffsetDateTime,
}

/// GET /api/orgs/{slug}/export
/// Owner/admin-only metadata dump for GDPR / due-diligence requests.
/// Excludes raw event payloads (potentially huge) — those are
/// retrievable per-issue via the existing admin API.
pub async fn export_org(
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

    let org_row: Option<OrgRow> = sqlx::query_as(
        "SELECT o.id, o.slug, o.name, o.owner_id, o.created_at, m.role \
         FROM orgs o JOIN memberships m ON m.org_id = o.id \
         WHERE o.id = $1 AND m.user_id = $2",
    )
    .bind(org_id)
    .bind(user.id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let org_row = match org_row {
        Some(r) => r,
        None => return not_found("orgNotFound"),
    };

    let members: Vec<MemberRow> = sqlx::query_as(
        "SELECT m.user_id, u.email, m.role, m.created_at \
         FROM memberships m JOIN users u ON u.id = m.user_id \
         WHERE m.org_id = $1 ORDER BY m.created_at",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let pending_invites: Vec<InviteRow> = sqlx::query_as(
        "SELECT i.token, i.email, i.role, i.expires_at, i.used_at, i.created_at, t.slug AS team_slug \
         FROM org_invites i LEFT JOIN teams t ON t.id = i.team_id \
         WHERE i.org_id = $1 AND i.used_at IS NULL \
         ORDER BY i.created_at",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    #[derive(sqlx::FromRow)]
    struct PRow {
        id: Uuid,
        name: String,
        created_at: OffsetDateTime,
    }
    let project_rows: Vec<PRow> = sqlx::query_as(
        "SELECT id, name, created_at FROM projects \
         WHERE org_id = $1 ORDER BY created_at",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    let mut projects = Vec::with_capacity(project_rows.len());
    for p in project_rows {
        let tokens: Vec<ExportedToken> = sqlx::query_as(
            "SELECT id, kind, label, last4, created_at, revoked_at \
             FROM tokens WHERE project_id = $1 ORDER BY created_at",
        )
        .bind(p.id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        let recipients: Vec<ExportedRecipient> = sqlx::query_as(
            "SELECT id, email, on_new_issue, on_regression, created_at \
             FROM notification_recipients WHERE project_id = $1 \
             ORDER BY created_at",
        )
        .bind(p.id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        projects.push(ExportedProject {
            id: p.id,
            name: p.name,
            created_at: p.created_at,
            tokens,
            recipients,
        });
    }

    let body = ExportResponse {
        org: org_row,
        members,
        projects,
        pending_invites,
    };

    let filename = format!(
        "sentori-{}-{}.json",
        slug,
        OffsetDateTime::now_utc().date()
    );
    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )],
        Json(body),
    )
        .into_response()
}

// ---------- usage / quota (Phase 15 sub-D) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageRow {
    plan: String,
    event_limit_monthly: i32,
    retention_days: i32,
    period_yyyymm: String,
    event_count: i64,
    dropped_count: i64,
    percent_used: f64,
    #[serde(with = "time::serde::rfc3339")]
    reset_at: OffsetDateTime,
}

pub async fn org_usage(
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

    let quota: Option<(String, i32, i32)> = sqlx::query_as(
        "SELECT plan::text, event_limit_monthly, retention_days \
         FROM org_quotas WHERE org_id = $1",
    )
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let (plan, limit, retention) = quota.unwrap_or_else(|| {
        (
            "free".to_string(),
            quotas::FREE_EVENT_LIMIT_MONTHLY,
            quotas::FREE_RETENTION_DAYS,
        )
    });

    let now = OffsetDateTime::now_utc();
    let period = quotas::period_key(now);

    // Prefer the live Valkey counters; fall back to the durable PG
    // rollup so the widget still renders if the cache is empty (e.g.
    // immediately after a Valkey restart, before the next 60 s flush).
    let (event_count, dropped_count) = match &state.valkey {
        Some(v) => {
            let mut conn = v.clone();
            let used: u64 = redis::AsyncCommands::get(
                &mut conn,
                format!("usage:{org_id}:{period}"),
            )
            .await
            .unwrap_or(0);
            let dropped: u64 = redis::AsyncCommands::get(
                &mut conn,
                format!("dropped:{org_id}:{period}"),
            )
            .await
            .unwrap_or(0);
            (used as i64, dropped as i64)
        }
        None => sqlx::query_as::<_, (i64, i64)>(
            "SELECT event_count, dropped_count FROM usage_counters \
             WHERE org_id = $1 AND period_yyyymm = $2",
        )
        .bind(org_id)
        .bind(&period)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .unwrap_or((0, 0)),
    };

    let percent_used = if limit > 0 {
        (event_count as f64 / limit as f64) * 100.0
    } else {
        0.0
    };

    let body = UsageRow {
        plan,
        event_limit_monthly: limit,
        retention_days: retention,
        period_yyyymm: period,
        event_count,
        dropped_count,
        percent_used,
        reset_at: quotas::next_period_start(now),
    };
    (StatusCode::OK, Json(body)).into_response()
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

    // Owner is reachable only via the ownership-transfer flow; PATCH
    // can swap admin / member / viewer freely. Self-demote is rejected
    // — it could orphan the only-owner check elsewhere.
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

// ---------- invites ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInviteBody {
    pub email: String,
    pub role: String,
    /// Optional team slug. When set, accept_invite atomically inserts a
    /// team_memberships row alongside the org membership.
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
    // VALID_INVITE_ROLES already excludes "owner" — owner is only
    // reachable via the ownership-transfer flow. Reject anything else
    // outright instead of mapping owner → cannotInviteAsOwner.
    if !VALID_INVITE_ROLES.contains(&body.role.as_str()) {
        return bad_request("invalidRole");
    }

    let team_id: Option<Uuid> = if let Some(team_slug) = body.team_slug.as_ref() {
        let s = team_slug.trim();
        if s.is_empty() {
            None
        } else {
            let id: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM teams WHERE org_id = $1 AND slug = $2",
            )
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

    // Attach to the invited team in the same transaction. If the team
    // was deleted while the invite sat in the inbox, team_id is NULL
    // (FK ON DELETE SET NULL) and we silently fall back to org-only.
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

// ---------- ownership transfer (Phase 18 sub-C) ----------

const TRANSFER_TTL_DAYS: i64 = 7;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTransferBody {
    pub to_user_id: Uuid,
}

/// POST /api/orgs/{slug}/transfer
/// Owner-only. Creates a pending transfer + emails the target a confirm link.
/// The target user must currently be admin or owner of the org.
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

    let target_role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2",
    )
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

/// POST /api/orgs/transfers/{token}/accept
/// Caller must be the to_user. Atomically swaps ownership: old owner
/// becomes admin, new owner becomes owner, transfer marked accepted.
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

    // Demote old owner → admin
    if let Err(e) = sqlx::query(
        "UPDATE memberships SET role = 'admin' WHERE org_id = $1 AND user_id = $2",
    )
    .bind(org_id)
    .bind(from_user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "demote old owner failed");
        return server_error("demoteOldOwner");
    }

    // Promote target → owner
    if let Err(e) = sqlx::query(
        "UPDATE memberships SET role = 'owner' WHERE org_id = $1 AND user_id = $2",
    )
    .bind(org_id)
    .bind(to_user_id)
    .execute(&mut *tx)
    .await
    {
        tracing::error!(error = %e, "promote new owner failed");
        return server_error("promoteNewOwner");
    }

    // Mirror the owner_id column for reads that don't go through memberships.
    if let Err(e) = sqlx::query("UPDATE orgs SET owner_id = $1 WHERE id = $2")
        .bind(to_user_id)
        .bind(org_id)
        .execute(&mut *tx)
        .await
    {
        tracing::error!(error = %e, "update orgs.owner_id failed");
        return server_error("updateOrgOwner");
    }

    if let Err(e) = sqlx::query(
        "UPDATE org_ownership_transfers SET accepted_at = now() WHERE id = $1",
    )
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

// ---------- audit log listing (Phase 18 sub-C) ----------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct AuditRow {
    id: Uuid,
    actor_user_id: Option<Uuid>,
    actor_email: Option<String>,
    action: String,
    target_type: String,
    target_id: Option<Uuid>,
    payload: serde_json::Value,
    created_at: OffsetDateTime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQuery {
    pub limit: Option<i64>,
    pub before: Option<OffsetDateTime>,
    pub action: Option<String>,
    pub actor_user_id: Option<Uuid>,
    pub target_type: Option<String>,
}

pub async fn list_audit(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    axum::extract::Query(q): axum::extract::Query<AuditQuery>,
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

    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let before = q.before.unwrap_or_else(OffsetDateTime::now_utc);

    // Build the query incrementally so optional filters drop in cleanly.
    let mut sql = String::from(
        "SELECT al.id, al.actor_user_id, u.email AS actor_email, al.action, \
                al.target_type, al.target_id, al.payload, al.created_at \
         FROM audit_logs al \
         LEFT JOIN users u ON u.id = al.actor_user_id \
         WHERE al.org_id = $1 AND al.created_at < $2",
    );
    let mut bind_idx = 3;
    if q.action.is_some() {
        sql.push_str(&format!(" AND al.action = ${bind_idx}"));
        bind_idx += 1;
    }
    if q.actor_user_id.is_some() {
        sql.push_str(&format!(" AND al.actor_user_id = ${bind_idx}"));
        bind_idx += 1;
    }
    if q.target_type.is_some() {
        sql.push_str(&format!(" AND al.target_type = ${bind_idx}"));
        bind_idx += 1;
    }
    sql.push_str(&format!(" ORDER BY al.created_at DESC LIMIT ${bind_idx}"));

    let mut query = sqlx::query_as::<_, AuditRow>(&sql).bind(org_id).bind(before);
    if let Some(a) = &q.action {
        query = query.bind(a);
    }
    if let Some(a) = &q.actor_user_id {
        query = query.bind(a);
    }
    if let Some(t) = &q.target_type {
        query = query.bind(t);
    }
    query = query.bind(limit);

    let rows: Vec<AuditRow> = query.fetch_all(&pool).await.unwrap_or_default();
    (StatusCode::OK, Json(rows)).into_response()
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
