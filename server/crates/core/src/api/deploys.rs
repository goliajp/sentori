// Phase 23 sub-C: deploy webhook.
//
// CI calls `POST /v1/deploys` after pushing a build to users so the
// dashboard knows when each release went live. Auth uses the same
// public token the SDK ingest path uses — same trust boundary, same
// rate-limit ceiling. Body is small JSON; we don't need multipart.
//
//     curl -X POST https://ingest.sentori.golia.jp/v1/deploys \
//          -H "Authorization: Bearer st_pk_..." \
//          -H "Content-Type: application/json" \
//          -d '{"release":"myapp@1.2.3+456","environment":"prod"}'
//
// Idempotent: re-deploying the same release just refreshes `deploy_at`.
// New releases land in the table at the same time so the dashboard
// list endpoint picks them up immediately.

use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::recent::AppState;

const RELEASE_MIN: usize = 1;
const RELEASE_MAX: usize = 200;
const ENV_MAX: usize = 64;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployBody {
    pub release: String,
    pub environment: Option<String>,
    /// RFC 3339 timestamp; defaults to server's `now()` when absent.
    /// Pass an explicit value for backfilling historical deploys.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub deployed_at: Option<OffsetDateTime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResponse {
    pub release: String,
    #[serde(with = "time::serde::rfc3339")]
    pub deploy_at: OffsetDateTime,
    pub release_id: Uuid,
}

pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(body): Json<DeployBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    let release = body.release.trim().to_string();
    if release.is_empty() || release.len() < RELEASE_MIN || release.len() > RELEASE_MAX {
        return bad_request("invalidRelease");
    }
    if let Some(env) = &body.environment {
        if env.is_empty() || env.len() > ENV_MAX {
            return bad_request("invalidEnvironment");
        }
    }

    let project_id = caller_project_id(&caller, &state);
    let deploy_at = body.deployed_at.unwrap_or_else(OffsetDateTime::now_utc);

    // Upsert: insert new release row if absent, otherwise refresh
    // deploy_at. We don't touch created_at — it stays at the row's
    // first-touch moment.
    let release_id = Uuid::now_v7();
    let row: Result<(Uuid,), sqlx::Error> = sqlx::query_as(
        "INSERT INTO releases (id, project_id, name, deploy_at) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (project_id, name) DO UPDATE \
         SET deploy_at = EXCLUDED.deploy_at \
         RETURNING id",
    )
    .bind(release_id)
    .bind(project_id)
    .bind(&release)
    .bind(deploy_at)
    .fetch_one(&pool)
    .await;

    let release_id = match row {
        Ok((id,)) => id,
        Err(e) => {
            tracing::error!(error = %e, %project_id, %release, "deploy upsert failed");
            return server_error("upsert");
        }
    };

    // Look up org_id for audit attribution. DevToken callers have no
    // associated org; we just skip the audit row in that case.
    let org_id: Option<Uuid> = match caller {
        IngestCaller::Token { org_id, .. } => Some(org_id),
        IngestCaller::DevToken => None,
    };
    if let Some(oid) = org_id {
        crate::audit::record(
            &pool,
            oid,
            None, // no user actor on token-auth — CI is the originator
            crate::audit::actions::RELEASE_DEPLOYED,
            crate::audit::targets::RELEASE,
            Some(release_id),
            json!({
                "project_id":  project_id,
                "release":     release,
                "environment": body.environment,
                "deploy_at":   deploy_at,
            }),
        )
        .await;
    }

    (
        StatusCode::CREATED,
        Json(DeployResponse {
            release,
            deploy_at,
            release_id,
        }),
    )
        .into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}
fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
