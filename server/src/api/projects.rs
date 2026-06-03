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
    #[serde(with = "time::serde::rfc3339")]
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

// ──────────────────────────────────────────────────────────────────
// Phase 42 sub-A.11 — PATCH /admin/api/projects/{id}
// ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchProjectBody {
    /// Set / clear `source_repo_url`. `Some(Some(url))` writes the
    /// url; `Some(None)` clears; absent leaves it untouched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "deserialize_optional_field")]
    pub source_repo_url: Option<Option<String>>,
    /// v2.5+ — project-level identity scope carve. `Some(Some(id))`
    /// points the project at an existing identity_scope (must
    /// belong to the project's org for safety); `Some(None)` clears
    /// the override, letting ingest fall back to the org default;
    /// absent leaves the column alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(deserialize_with = "deserialize_optional_uuid")]
    pub identity_scope_id: Option<Option<Uuid>>,
}

// serde idiom for distinguishing absent vs explicit null: deserialize
// `Some(value)` for present (whether the value is null or a string).
fn deserialize_optional_field<'de, D>(de: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(de)?))
}

fn deserialize_optional_uuid<'de, D>(de: D) -> Result<Option<Option<Uuid>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(Option::<Uuid>::deserialize(de)?))
}

/// PATCH /admin/api/projects/{project_id}
/// Update a project's settings. Currently only `source_repo_url` is
/// editable; the field doesn't change the data model so PATCH is
/// open to any user with org-admin / org-owner role over the
/// project's org (same gate as `create_project`).
pub async fn patch_project(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<PatchProjectBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    // Validate URL shape if present + non-null.
    if let Some(Some(ref url)) = body.source_repo_url {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            // Treat empty string as "clear".
        } else if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
            return bad_request("sourceRepoUrlMustBeHttp");
        } else if trimmed.len() > 512 {
            return bad_request("sourceRepoUrlTooLong");
        }
    }

    // Resolve the project's org + caller role.
    let project_org: Option<(Uuid,)> =
        sqlx::query_as("SELECT org_id FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);
    let Some((org_id,)) = project_org else {
        return not_found("projectNotFound");
    };

    let role: Option<String> = match &caller {
        AdminCaller::User { id, .. } => sqlx::query_scalar(
            "SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2",
        )
        .bind(org_id)
        .bind(id)
        .fetch_optional(&pool)
        .await
        .unwrap_or(None),
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => Some("owner".to_string()),
    };
    let role = match role {
        Some(r) if matches!(r.as_str(), "owner" | "admin") => r,
        _ => return forbidden("forbidden"),
    };
    let _ = role; // silence unused warning; gate above uses it.

    if let Some(opt) = body.source_repo_url {
        // Empty string → clear. Anything else stored verbatim.
        let value = opt.and_then(|s| {
            let t = s.trim();
            if t.is_empty() { None } else { Some(t.to_string()) }
        });
        if let Err(e) = sqlx::query("UPDATE projects SET source_repo_url = $1 WHERE id = $2")
            .bind(value.as_deref())
            .bind(project_id)
            .execute(&pool)
            .await
        {
            tracing::error!(error = %e, %project_id, "patch_project failed");
            return server_error("dbError");
        }
        let actor = match &caller {
            AdminCaller::User { id, .. } => Some(*id),
            _ => None,
        };
        crate::audit::record(
            &pool,
            org_id,
            actor,
            crate::audit::actions::PROJECT_UPDATED,
            crate::audit::targets::PROJECT,
            Some(project_id),
            json!({ "sourceRepoUrl": value }),
        )
        .await;
    }

    // v2.5+ — project-level identity scope carve. `Some(Some(id))`
    // points the project at the named scope; `Some(None)` clears.
    // We validate that the target scope (a) exists and (b) belongs
    // to the same org as the project — cross-org carves would let
    // an admin leak identity correlations across tenants.
    if let Some(opt) = body.identity_scope_id {
        if let Some(scope_id) = opt {
            // Safety: only allow scopes that live in this org.
            // Schema doesn't carry an `org_id` on identity_scopes
            // directly; check via the org_identity_scopes mapping.
            let owns: bool = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS ( \
                   SELECT 1 FROM org_identity_scopes \
                   WHERE org_id = $1 AND scope_id = $2 \
                 )",
            )
            .bind(org_id)
            .bind(scope_id)
            .fetch_one(&pool)
            .await
            .unwrap_or(false);
            if !owns {
                return bad_request("identityScopeNotInOrg");
            }
        }
        if let Err(e) =
            sqlx::query("UPDATE projects SET identity_scope_id = $1 WHERE id = $2")
                .bind(opt)
                .bind(project_id)
                .execute(&pool)
                .await
        {
            tracing::error!(error = %e, %project_id, "patch_project identity_scope_id failed");
            return server_error("dbError");
        }
        let actor = match &caller {
            AdminCaller::User { id, .. } => Some(*id),
            _ => None,
        };
        crate::audit::record(
            &pool,
            org_id,
            actor,
            crate::audit::actions::PROJECT_UPDATED,
            crate::audit::targets::PROJECT,
            Some(project_id),
            json!({ "identityScopeId": opt }),
        )
        .await;
    }

    (StatusCode::NO_CONTENT, ()).into_response()
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
