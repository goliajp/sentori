// Phase 27 sub-E: digest subscriptions self-serve.
//
// Endpoints under `/api/users/me/digests` (require_user). All actions
// scope to the calling user — no cross-user listing or admin override
// here. An org admin who wants to subscribe their team to digests
// would do so via per-user signups; we don't bulk-subscribe people
// who didn't ask.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::user_auth::CurrentUser;
use crate::recent::AppState;

const VALID_FREQUENCIES: &[&str] = &["daily", "weekly"];

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DigestRow {
    pub org_id: Uuid,
    pub org_slug: String,
    pub frequency: String,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub last_sent_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub async fn list_my_digests(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let rows: Vec<DigestRow> = sqlx::query_as(
        "SELECT d.org_id, o.slug AS org_slug, d.frequency, d.last_sent_at, d.created_at \
         FROM digest_subscriptions d \
         JOIN orgs o ON o.id = d.org_id \
         WHERE d.user_id = $1 \
         ORDER BY o.slug, d.frequency",
    )
    .bind(user.id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();
    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeBody {
    pub org_slug: String,
    pub frequency: String,
}

pub async fn subscribe(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Json(body): Json<SubscribeBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    if !VALID_FREQUENCIES.contains(&body.frequency.as_str()) {
        return bad_request("invalidFrequency");
    }
    let org_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT o.id FROM orgs o \
         JOIN memberships m ON m.org_id = o.id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(&body.org_slug)
    .bind(user.id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    let Some(org_id) = org_id else {
        return not_found("orgNotFound");
    };
    if let Err(e) = sqlx::query(
        "INSERT INTO digest_subscriptions (user_id, org_id, frequency) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, org_id, frequency) DO NOTHING",
    )
    .bind(user.id)
    .bind(org_id)
    .bind(&body.frequency)
    .execute(&pool)
    .await
    {
        tracing::error!(error = %e, "digest subscribe failed");
        return server_error("insert");
    }
    (StatusCode::CREATED, Json(json!({ "ok": true }))).into_response()
}

pub async fn unsubscribe(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((org_slug, frequency)): Path<(String, String)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    if !VALID_FREQUENCIES.contains(&frequency.as_str()) {
        return bad_request("invalidFrequency");
    }
    let res = sqlx::query(
        "DELETE FROM digest_subscriptions \
         WHERE user_id = $1 \
           AND frequency = $2 \
           AND org_id = (SELECT id FROM orgs WHERE slug = $3)",
    )
    .bind(user.id)
    .bind(&frequency)
    .bind(&org_slug)
    .execute(&pool)
    .await;
    match res {
        Ok(r) if r.rows_affected() > 0 => (StatusCode::NO_CONTENT, ()).into_response(),
        _ => not_found("subscriptionNotFound"),
    }
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
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
