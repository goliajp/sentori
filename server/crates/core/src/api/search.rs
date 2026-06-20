// Phase 28 sub-A: Cmd+K global search.
//
// `GET /admin/api/search?q=<term>&types=org,project,issue,team,member`
// (types defaults to all). Returns ranked results scoped to whatever
// the caller can see — same admin_auth layer as the rest of /admin/api,
// so a member of one org can't probe another's issues.
//
// Matching is a simple `ILIKE '%q%'` per type. PG full-text indexes
// land if + when query latency on the issues table actually justifies
// them (v0.2 dataset is small). Per-type LIMIT 10 keeps the response
// bounded; the dashboard renders sections in `type` order.
//
// Returned shape is uniform per result so the dashboard can render
// them with one component:
//   { type, id, label, sublabel?, url }

use axum::{
    extract::{Extension, Json, Query, State},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

const PER_TYPE_LIMIT: i64 = 10;
const Q_MIN: usize = 1;
const Q_MAX: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub q: String,
    /// Comma-separated subset; empty = all.
    pub types: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub r#type: &'static str,
    pub id: String,
    pub label: String,
    pub sublabel: Option<String>,
    pub url: String,
}

pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<SearchHit>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let q_trim = q.q.trim();
    if q_trim.len() < Q_MIN || q_trim.len() > Q_MAX {
        return Err(AppError::Internal("invalid query length".into()));
    }
    // Tokens / legacy admin paths get full visibility — they're
    // already gated above this layer.
    let user_id: Option<Uuid> = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => None,
    };
    let pattern = format!("%{}%", q_trim.replace('%', "\\%").replace('_', "\\_"));

    let types: Vec<&str> = q
        .types
        .as_deref()
        .map(|s| s.split(',').filter(|s| !s.is_empty()).collect())
        .unwrap_or_else(|| vec!["org", "team", "project", "issue", "member"]);

    let mut hits: Vec<SearchHit> = Vec::new();

    if types.contains(&"org") {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT o.slug, o.name FROM orgs o \
             WHERE ($3::UUID IS NULL OR EXISTS (\
                SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = $3)) \
             AND (o.name ILIKE $1 OR o.slug ILIKE $1) \
             ORDER BY o.created_at LIMIT $2",
        )
        .bind(&pattern)
        .bind(PER_TYPE_LIMIT)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for (slug, name) in rows {
            hits.push(SearchHit {
                id: slug.clone(),
                label: name,
                r#type: "org",
                sublabel: Some(slug.clone()),
                url: format!("/org/{slug}"),
            });
        }
    }

    if types.contains(&"team") {
        let rows: Vec<(String, String, String)> = sqlx::query_as(
            "SELECT t.slug, t.name, o.slug AS org_slug FROM teams t \
             JOIN orgs o ON o.id = t.org_id \
             WHERE ($3::UUID IS NULL OR EXISTS (\
                SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = $3)) \
             AND (t.name ILIKE $1 OR t.slug ILIKE $1) \
             ORDER BY t.created_at LIMIT $2",
        )
        .bind(&pattern)
        .bind(PER_TYPE_LIMIT)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for (slug, name, org_slug) in rows {
            hits.push(SearchHit {
                id: format!("{org_slug}/{slug}"),
                label: name,
                r#type: "team",
                sublabel: Some(format!("{org_slug} · team")),
                url: format!("/org/{org_slug}/teams/{slug}"),
            });
        }
    }

    if types.contains(&"project") {
        let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
            "SELECT p.id, p.name, o.slug AS org_slug FROM projects p \
             JOIN orgs o ON o.id = p.org_id \
             WHERE ($3::UUID IS NULL OR EXISTS (\
                SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = $3)) \
             AND p.name ILIKE $1 \
             ORDER BY p.created_at LIMIT $2",
        )
        .bind(&pattern)
        .bind(PER_TYPE_LIMIT)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for (id, name, org_slug) in rows {
            hits.push(SearchHit {
                id: id.to_string(),
                label: name,
                r#type: "project",
                sublabel: Some(format!("{org_slug} · project")),
                url: format!("/org/{org_slug}"),
            });
        }
    }

    if types.contains(&"issue") {
        let rows: Vec<(Uuid, String, String, String)> = sqlx::query_as(
            "SELECT i.id, i.error_type, i.message_sample, o.slug AS org_slug \
             FROM issues i \
             JOIN projects p ON p.id = i.project_id \
             JOIN orgs o ON o.id = p.org_id \
             WHERE ($3::UUID IS NULL OR EXISTS (\
                SELECT 1 FROM memberships m WHERE m.org_id = o.id AND m.user_id = $3)) \
             AND (i.error_type ILIKE $1 OR i.message_sample ILIKE $1) \
             ORDER BY i.last_seen DESC LIMIT $2",
        )
        .bind(&pattern)
        .bind(PER_TYPE_LIMIT)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for (id, etype, msg, org_slug) in rows {
            hits.push(SearchHit {
                id: id.to_string(),
                label: etype,
                r#type: "issue",
                sublabel: Some(if msg.len() > 80 {
                    format!("{} · {}…", org_slug, &msg[..80])
                } else {
                    format!("{org_slug} · {msg}")
                }),
                url: format!("/org/{org_slug}/issues/{id}"),
            });
        }
    }

    if types.contains(&"member") {
        // Members are scoped to the caller's orgs only — no cross-org
        // member discovery.
        let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
            "SELECT DISTINCT u.id, u.email, o.slug AS org_slug FROM users u \
             JOIN memberships m ON m.user_id = u.id \
             JOIN orgs o ON o.id = m.org_id \
             WHERE ($3::UUID IS NULL OR EXISTS (\
                SELECT 1 FROM memberships m2 WHERE m2.org_id = o.id AND m2.user_id = $3)) \
             AND u.email ILIKE $1 \
             ORDER BY u.email LIMIT $2",
        )
        .bind(&pattern)
        .bind(PER_TYPE_LIMIT)
        .bind(user_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        for (id, email, org_slug) in rows {
            hits.push(SearchHit {
                id: id.to_string(),
                label: email,
                r#type: "member",
                sublabel: Some(format!("{org_slug} · member")),
                url: format!("/org/{org_slug}/settings"),
            });
        }
    }

    Ok(Json(hits))
}
