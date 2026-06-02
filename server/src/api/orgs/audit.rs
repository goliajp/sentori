// Audit action catalog + per-org audit log + per-user activity feed.
//
// v1.1 P2 split-out of `api/orgs.rs`.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use super::{forbidden, not_found, resolve_membership, server_error};
use crate::api::user_auth::CurrentUser;
use crate::recent::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditAction {
    code: &'static str,
    label: &'static str,
}

/// GET /api/audit/actions — catalog of every action code the server can
/// emit, paired with its human-readable English label.
pub async fn list_audit_actions() -> Response {
    let body: Vec<AuditAction> = crate::audit::all_labels()
        .into_iter()
        .map(|(code, label)| AuditAction { code, label })
        .collect();
    (StatusCode::OK, Json(body)).into_response()
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct UserActivityRow {
    id: Uuid,
    org_id: Option<Uuid>,
    org_slug: Option<String>,
    org_name: Option<String>,
    action: String,
    target_type: String,
    target_id: Option<Uuid>,
    payload: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserActivityQuery {
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub before: Option<OffsetDateTime>,
    pub limit: Option<i64>,
}

pub async fn list_my_activity(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Query(q): Query<UserActivityQuery>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    // v2.1 — cap bumped 200 → 500. Audit / activity logs accumulate
    // fast on busy orgs; the previous ceiling left older entries
    // unreachable from the dashboard. Cursor pagination is the
    // proper v2.x fix; this unblocks typical orgs without a
    // server-protocol change.
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let before = q.before.unwrap_or_else(OffsetDateTime::now_utc);

    let rows: Vec<UserActivityRow> = sqlx::query_as(
        "SELECT al.id, al.org_id, o.slug AS org_slug, o.name AS org_name, \
                al.action, al.target_type, al.target_id, al.payload, al.created_at \
         FROM audit_logs al \
         LEFT JOIN orgs o ON o.id = al.org_id \
         WHERE al.actor_user_id = $1 AND al.created_at < $2 \
         ORDER BY al.created_at DESC \
         LIMIT $3",
    )
    .bind(user.id)
    .bind(before)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

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
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditQuery {
    pub limit: Option<i64>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub before: Option<OffsetDateTime>,
    pub action: Option<String>,
    pub actor_user_id: Option<Uuid>,
    pub target_type: Option<String>,
}

pub async fn list_audit(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Query(q): Query<AuditQuery>,
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

    // v2.1 — cap bumped 200 → 500. Audit / activity logs accumulate
    // fast on busy orgs; the previous ceiling left older entries
    // unreachable from the dashboard. Cursor pagination is the
    // proper v2.x fix; this unblocks typical orgs without a
    // server-protocol change.
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let before = q.before.unwrap_or_else(OffsetDateTime::now_utc);

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
