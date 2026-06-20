// Phase 24 sub-C: saved views CRUD.
//
// Routes (all behind `/api/orgs/{slug}/views`, require_user):
//   GET    /                 list views the caller can see in this org
//   POST   /                 create a view (personal | team | org scope)
//   DELETE /:id              delete a view
//
// Visibility rules:
//   - personal: only the creator sees / deletes
//   - team:     only members of `team_id`; org owner/admin can also see+delete
//   - org:      every org member can see; only owner/admin can delete
//
// Creation:
//   - personal: any org member can create their own
//   - team:     team lead OR org owner/admin
//   - org:      org owner/admin only
//
// Audit: keeping the view table simple is the goal — these are
// per-user UI prefs, not security-relevant state. We don't write audit
// rows for views (would dilute the trail).

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::teams::resolve_membership;
use crate::api::user_auth::CurrentUser;
use crate::recent::AppState;

const NAME_MIN: usize = 1;
const NAME_MAX: usize = 80;
const VALID_TARGETS: &[&str] = &["issues"];
const VALID_SCOPES: &[&str] = &["personal", "team", "org"];

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ViewRow {
    pub id: Uuid,
    pub target: String,
    pub scope: String,
    pub team_id: Option<Uuid>,
    pub team_slug: Option<String>,
    pub user_id: Option<Uuid>,
    pub name: String,
    pub payload: JsonValue,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub created_by: Option<Uuid>,
    pub created_by_email: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Deserialize)]
pub struct ListQuery {
    /// Defaults to "issues" — first (and only, in v0.2) discriminator.
    pub target: Option<String>,
}

pub async fn list_views(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    axum::extract::Query(q): axum::extract::Query<ListQuery>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let target = q.target.unwrap_or_else(|| "issues".into());
    if !VALID_TARGETS.contains(&target.as_str()) {
        return bad_request("invalidTarget");
    }

    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    let is_admin = matches!(role.as_str(), "owner" | "admin");

    // org-scope: visible to all members. team-scope: only members of
    // that team — except org owner/admin sees every team's views (they
    // need a single pane for all triage). personal-scope: only own.
    let rows: Vec<ViewRow> = sqlx::query_as(
        r#"
        SELECT
            v.id, v.target, v.scope, v.team_id, t.slug AS team_slug,
            v.user_id, v.name, v.payload,
            v.created_at, v.created_by, u.email AS created_by_email,
            v.updated_at
        FROM saved_views v
        LEFT JOIN teams t ON t.id = v.team_id
        LEFT JOIN users u ON u.id = v.created_by
        WHERE v.org_id = $1 AND v.target = $2
          AND (
                v.scope = 'org'
             OR (v.scope = 'personal' AND v.user_id = $3)
             OR (v.scope = 'team' AND (
                    $4
                 OR v.team_id IN (
                        SELECT team_id FROM team_memberships WHERE user_id = $3
                    )
                ))
          )
        ORDER BY v.scope, v.created_at
        "#,
    )
    .bind(org_id)
    .bind(&target)
    .bind(user.id)
    .bind(is_admin)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    pub target: Option<String>,
    pub scope: String,
    pub team_slug: Option<String>,
    pub name: String,
    pub payload: JsonValue,
}

pub async fn create_view(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let target = body.target.as_deref().unwrap_or("issues");
    if !VALID_TARGETS.contains(&target) {
        return bad_request("invalidTarget");
    }
    if !VALID_SCOPES.contains(&body.scope.as_str()) {
        return bad_request("invalidScope");
    }
    let trimmed_name = body.name.trim();
    let name_len = trimmed_name.chars().count();
    if name_len < NAME_MIN || name_len > NAME_MAX {
        return bad_request("invalidName");
    }

    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    let is_admin = matches!(role.as_str(), "owner" | "admin");

    let (team_id, user_id_col): (Option<Uuid>, Option<Uuid>) = match body.scope.as_str() {
        "personal" => (None, Some(user.id)),
        "team" => {
            let team_slug = match body.team_slug.as_deref() {
                Some(s) if !s.is_empty() => s,
                _ => return bad_request("teamSlugRequired"),
            };
            let team_id: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM teams WHERE org_id = $1 AND slug = $2",
            )
            .bind(org_id)
            .bind(team_slug)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
            let team_id = match team_id {
                Some(t) => t,
                None => return not_found("teamNotFound"),
            };
            // Permission: org admin OR team lead.
            let is_lead: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM team_memberships \
                 WHERE team_id = $1 AND user_id = $2 AND role = 'lead')",
            )
            .bind(team_id)
            .bind(user.id)
            .fetch_one(&pool)
            .await
            .unwrap_or(false);
            if !is_admin && !is_lead {
                return forbidden("notTeamLeadOrOrgAdmin");
            }
            (Some(team_id), None)
        }
        "org" => {
            if !is_admin {
                return forbidden("notOrgAdmin");
            }
            (None, None)
        }
        _ => unreachable!(),
    };

    let id = Uuid::now_v7();
    let res: Result<(), sqlx::Error> = sqlx::query(
        r#"
        INSERT INTO saved_views
            (id, org_id, target, scope, team_id, user_id, name, payload, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(id)
    .bind(org_id)
    .bind(target)
    .bind(&body.scope)
    .bind(team_id)
    .bind(user_id_col)
    .bind(trimmed_name)
    .bind(&body.payload)
    .bind(user.id)
    .execute(&pool)
    .await
    .map(|_| ());
    if let Err(e) = res {
        tracing::error!(error = %e, "create saved view failed");
        return server_error("insert");
    }

    (StatusCode::CREATED, Json(json!({ "id": id }))).into_response()
}

pub async fn delete_view(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((slug, id)): Path<(String, Uuid)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    let is_admin = matches!(role.as_str(), "owner" | "admin");

    let row: Option<(String, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
        "SELECT scope, team_id, user_id FROM saved_views WHERE id = $1 AND org_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let (scope, team_id, user_id) = match row {
        Some(r) => r,
        None => return not_found("viewNotFound"),
    };

    let allowed = match scope.as_str() {
        "personal" => user_id == Some(user.id) || is_admin,
        "team" => {
            if is_admin {
                true
            } else if let Some(tid) = team_id {
                sqlx::query_scalar::<_, bool>(
                    "SELECT EXISTS(SELECT 1 FROM team_memberships \
                     WHERE team_id = $1 AND user_id = $2 AND role = 'lead')",
                )
                .bind(tid)
                .bind(user.id)
                .fetch_one(&pool)
                .await
                .unwrap_or(false)
            } else {
                false
            }
        }
        "org" => is_admin,
        _ => false,
    };
    if !allowed {
        return forbidden("notAllowed");
    }

    if let Err(e) = sqlx::query("DELETE FROM saved_views WHERE id = $1")
        .bind(id)
        .execute(&pool)
        .await
    {
        tracing::error!(error = %e, %id, "delete saved view failed");
        return server_error("delete");
    }

    (StatusCode::NO_CONTENT, ()).into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
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
