// GDPR data export + usage / quota.
//
// v1.1 P2 split-out of `api/orgs.rs`.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{forbidden, not_found, resolve_membership, server_error, InviteRow, MemberRow, OrgRow};
use crate::api::user_auth::CurrentUser;
use crate::quotas;
use crate::recent::AppState;

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
    #[serde(with = "time::serde::rfc3339")]
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
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    revoked_at: Option<OffsetDateTime>,
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct ExportedRecipient {
    id: Uuid,
    email: String,
    on_new_issue: bool,
    on_regression: bool,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

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
        "SELECT id, name, created_at FROM projects WHERE org_id = $1 ORDER BY created_at",
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

    let (event_count, dropped_count) = match &state.valkey {
        Some(v) => {
            let mut conn = v.clone();
            let used: u64 =
                redis::AsyncCommands::get(&mut conn, format!("usage:{org_id}:{period}"))
                    .await
                    .unwrap_or(0);
            let dropped: u64 =
                redis::AsyncCommands::get(&mut conn, format!("dropped:{org_id}:{period}"))
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
