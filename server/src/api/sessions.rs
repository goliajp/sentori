// Phase 26 sub-A: session ping ingest.
//
// `POST /v1/sessions` accepts a single ping at session close. Auth and
// rate-limit live in the same `require_token` group as `/v1/events` —
// session pings are part of the ingest budget.
//
// We intentionally don't accept batches yet: pings are tiny (a few
// hundred bytes) and per-session rate is at most a handful per user
// per day. If it becomes a hotspot we'll add `/v1/sessions:batch`
// mirroring the events endpoint.

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

const RELEASE_MAX: usize = 200;
const ENV_MAX: usize = 64;
const USER_ID_MAX: usize = 200;
const DURATION_MS_MAX: i32 = 7 * 24 * 60 * 60 * 1000; // 1 week — anything past this is a clock skew bug, not a real session

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPing {
    pub id: Uuid,
    /// Application-defined user identifier. NULL → anonymous.
    /// Capped to keep storage predictable; SDKs should hash long ids.
    pub user_id: Option<String>,
    pub release: String,
    pub environment: String,
    /// `ok` (normal foreground→background), `errored` (had a non-fatal
    /// error but session continued), `crashed` (process died), `exited`
    /// (explicit user-initiated quit). Mapping back to crash-free
    /// metrics: `ok | exited` count as healthy, `errored | crashed`
    /// count as unhealthy.
    pub status: String,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    pub duration_ms: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAck {
    pub id: Uuid,
}

const VALID_STATUSES: &[&str] = &["ok", "errored", "crashed", "exited"];

pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(body): Json<SessionPing>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    if body.release.is_empty() || body.release.len() > RELEASE_MAX {
        return bad_request("invalidRelease");
    }
    if body.environment.is_empty() || body.environment.len() > ENV_MAX {
        return bad_request("invalidEnvironment");
    }
    if let Some(uid) = &body.user_id {
        if uid.is_empty() || uid.len() > USER_ID_MAX {
            return bad_request("invalidUserId");
        }
    }
    if !VALID_STATUSES.contains(&body.status.as_str()) {
        return bad_request("invalidStatus");
    }
    if body.duration_ms < 0 || body.duration_ms > DURATION_MS_MAX {
        return bad_request("invalidDurationMs");
    }

    let project_id = caller_project_id(&caller, &state);

    let res: Result<(), sqlx::Error> = sqlx::query(
        r#"
        INSERT INTO sessions
            (id, project_id, user_id, release, environment, status,
             started_at, duration_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(body.id)
    .bind(project_id)
    .bind(body.user_id.as_deref())
    .bind(&body.release)
    .bind(&body.environment)
    .bind(&body.status)
    .bind(body.started_at)
    .bind(body.duration_ms)
    .execute(&pool)
    .await
    .map(|_| ());

    if let Err(e) = res {
        tracing::error!(error = %e, %project_id, %body.id, "session insert failed");
        return server_error("insert");
    }

    (StatusCode::ACCEPTED, Json(SessionAck { id: body.id })).into_response()
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
