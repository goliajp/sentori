// Phase 14 sub-section A: project create endpoint.
// list_my_projects already lives in api/admin.rs; this module owns mutations.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::recent::AppState;

const NAME_MIN: usize = 1;
const NAME_MAX: usize = 64;

#[derive(Deserialize)]
pub struct CreateProjectBody {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCreated {
    pub created_at: OffsetDateTime,
    pub id: Uuid,
    pub name: String,
    pub org_id: Uuid,
    pub org_slug: String,
}

/// POST /admin/api/orgs/{slug}/projects
/// User caller must be owner or admin of the org. LegacyAdmin / DevToken
/// callers bypass the role check (super-admin).
pub async fn create_project(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(slug): Path<String>,
    Json(body): Json<CreateProjectBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let name = body.name.trim().to_string();
    let len = name.chars().count();
    if !(NAME_MIN..=NAME_MAX).contains(&len) {
        return bad_request("invalidName");
    }

    // Resolve the org and the caller's role within it.
    let (org_id, role) = match resolve_org(&pool, &slug, &caller).await {
        Ok(Some(v)) => v,
        Ok(None) => return not_found("orgNotFound"),
        Err(e) => {
            tracing::error!(error = %e, "resolve_org failed");
            return server_error("dbError");
        }
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return forbidden("forbidden");
    }

    let project_id = Uuid::now_v7();
    if let Err(e) = sqlx::query(
        "INSERT INTO projects (id, name, org_id) VALUES ($1, $2, $3)",
    )
    .bind(project_id)
    .bind(&name)
    .bind(org_id)
    .execute(&pool)
    .await
    {
        tracing::error!(error = %e, "insert project failed");
        return server_error("insertProject");
    }

    let row: Option<(OffsetDateTime,)> =
        sqlx::query_as("SELECT created_at FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    let created_at = row.map(|r| r.0).unwrap_or_else(OffsetDateTime::now_utc);

    let actor = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };
    crate::audit::record(
        &pool,
        org_id,
        actor,
        crate::audit::actions::PROJECT_CREATED,
        crate::audit::targets::PROJECT,
        Some(project_id),
        json!({ "name": name }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(ProjectCreated {
            created_at,
            id: project_id,
            name,
            org_id,
            org_slug: slug,
        }),
    )
        .into_response()
}

/// Returns (org_id, role) where role is "owner"/"admin"/"member" for User
/// callers, or the synthetic "owner" for super-admin callers (so the
/// downstream role check passes).
async fn resolve_org(
    pool: &PgPool,
    slug: &str,
    caller: &AdminCaller,
) -> Result<Option<(Uuid, String)>, sqlx::Error> {
    match caller {
        AdminCaller::User { id, .. } => {
            sqlx::query_as::<_, (Uuid, String)>(
                "SELECT o.id, m.role FROM orgs o \
                 JOIN memberships m ON m.org_id = o.id \
                 WHERE o.slug = $1 AND m.user_id = $2",
            )
            .bind(slug)
            .bind(id)
            .fetch_optional(pool)
            .await
        }
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => {
            let id: Option<Uuid> =
                sqlx::query_scalar("SELECT id FROM orgs WHERE slug = $1")
                    .bind(slug)
                    .fetch_optional(pool)
                    .await?;
            Ok(id.map(|id| (id, "owner".to_string())))
        }
    }
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
