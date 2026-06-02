// v1.1 chunk S4 — federation link ingest + cross-project lookup.
//
// Ingest:
//   POST /v1/security/link
//     body: { provider, subject, userId?, installId? }
//     Stores / re-asserts the (project, provider, subject) → user
//     mapping. Idempotent; the SDK calls this on every sign-in.
//
// Admin:
//   GET /admin/api/orgs/{slug}/federation/{provider}/{subject}
//     Lists every project in the caller's org that has a link for
//     this (provider, subject) tuple, plus the user_id + install_id
//     on that side. Powers the cross-project view in Posture.

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
use validator::Validate;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::error::{AppError, err_response_with, flatten_validation_errors};
use crate::recent::AppState;

const PROVIDER_MAX: usize = 64;
const SUBJECT_MAX: usize = 200;
const USER_ID_MAX: usize = 200;
const INSTALL_ID_MAX: usize = 64;

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct LinkRequest {
    /// Reverse-DNS-ish provider key: `google`, `github`, `apple`,
    /// `microsoft`, `custom.acme`. Free-form so operators can wire
    /// internal SSO without server changes.
    #[validate(length(min = 1, max = 64))]
    pub provider: String,
    /// Opaque pseudonymous identifier the provider issued for this
    /// account. NEVER an email or any human-readable handle.
    #[validate(length(min = 1, max = 200))]
    pub subject: String,
    pub user_id: Option<String>,
    pub install_id: Option<String>,
}

pub async fn link(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(body): Json<LinkRequest>,
) -> Response {
    if let Err(e) = body.validate() {
        return err_response_with(
            StatusCode::BAD_REQUEST,
            "federation.invalidLink",
            "link request failed validation",
            Some("see error.details for per-field messages".to_string()),
            Some("https://sentori.golia.jp/docs/errors/federation.invalidLink".to_string()),
            "domain.federation",
            flatten_validation_errors(&e),
        );
    }
    if let Some(u) = &body.user_id {
        if u.is_empty() || u.len() > USER_ID_MAX {
            return bad_field("userId");
        }
    }
    if let Some(i) = &body.install_id {
        if i.is_empty() || i.len() > INSTALL_ID_MAX {
            return bad_field("installId");
        }
    }
    let _ = PROVIDER_MAX;
    let _ = SUBJECT_MAX;

    let project_id = caller_project_id(&caller, &state);
    let Some(pool) = state.db.clone() else {
        return (
            StatusCode::ACCEPTED,
            axum::Json(json!({ "accepted": false, "reason": "dbNotConfigured" })),
        )
            .into_response();
    };

    let id = Uuid::now_v7();
    let r = sqlx::query(
        "INSERT INTO user_federation_links \
            (id, project_id, provider, subject, user_id, install_id, created_at) \
         VALUES ($1, $2, $3, $4, $5, $6, now()) \
         ON CONFLICT (project_id, provider, subject) DO UPDATE \
         SET user_id = EXCLUDED.user_id, \
             install_id = EXCLUDED.install_id, \
             created_at = now()",
    )
    .bind(id)
    .bind(project_id)
    .bind(&body.provider)
    .bind(&body.subject)
    .bind(body.user_id.as_deref())
    .bind(body.install_id.as_deref())
    .execute(&pool)
    .await;
    if let Err(e) = r {
        tracing::error!(error = %e, %project_id, "federation link insert failed");
        return err_response_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal.unexpected",
            "could not persist link",
            None,
            None,
            "internal",
            vec![],
        );
    }

    tracing::info!(%project_id, provider = %body.provider, "federation link upserted");
    (StatusCode::ACCEPTED, axum::Json(json!({ "ok": true }))).into_response()
}

fn bad_field(field: &str) -> Response {
    err_response_with(
        StatusCode::BAD_REQUEST,
        "federation.invalidLink",
        format!("`{field}` exceeds cap or is empty"),
        None,
        None,
        "domain.federation",
        vec![],
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FederationRow {
    pub project_id: Uuid,
    pub project_name: Option<String>,
    pub user_id: Option<String>,
    pub install_id: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupPath {
    pub slug: String,
    pub provider: String,
    pub subject: String,
}

pub async fn lookup_by_subject(
    State(state): State<AppState>,
    Path(LookupPath {
        slug,
        provider,
        subject,
    }): Path<LookupPath>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(axum::Json(Vec::<FederationRow>::new()).into_response());
    };
    // Join through projects + orgs to scope to the requested org slug
    // — operators only ever see the projects they own / are a member
    // of. Auth gating runs in the admin middleware before this
    // handler.
    let rows = fetch_links_for_org(pool, &slug, &provider, &subject).await?;
    Ok(axum::Json(rows).into_response())
}

async fn fetch_links_for_org(
    pool: &PgPool,
    slug: &str,
    provider: &str,
    subject: &str,
) -> Result<Vec<FederationRow>, AppError> {
    let rows: Vec<(Uuid, Option<String>, Option<String>, Option<String>, OffsetDateTime)> =
        sqlx::query_as(
            "SELECT l.project_id, p.name, l.user_id, l.install_id, l.created_at \
             FROM user_federation_links l \
             JOIN projects p ON p.id = l.project_id \
             JOIN orgs o ON o.id = p.org_id \
             WHERE o.slug = $1 AND l.provider = $2 AND l.subject = $3 \
             ORDER BY l.created_at DESC",
        )
        .bind(slug)
        .bind(provider)
        .bind(subject)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(rows
        .into_iter()
        .map(
            |(project_id, project_name, user_id, install_id, created_at)| FederationRow {
                project_id,
                project_name,
                user_id,
                install_id,
                created_at,
            },
        )
        .collect())
}
