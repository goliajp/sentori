// v1.1 chunk B — analytics `track` ingest.
//
// `POST /v1/track:batch` — ingest token, up to 500 events per batch.
// Each event: `{ name, ts?, userId?, sessionId?, route?, release?,
// environment?, props? }`.
//
// Track events live in their own table (`track_events`, migration
// 0046) so the high-volume analytics path doesn't compete with the
// error / ANR ingest loop for the `events` partition. Hourly rollups
// land in chunk C; this endpoint stays the raw stream.
//
// Errors follow the F2 structured envelope: `track.batchTooLarge` is
// the per-call cap, the auth boundary owns 401 / 403 codes.

use std::collections::BTreeMap;

use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;
use validator::Validate;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::error::err_response_with;
use crate::recent::AppState;

const MAX_BATCH: usize = 500;
const PROPS_KEYS_MAX: usize = 40;
/// v1.1 audit-closeout B — per-event serialised cap on `props` JSONB.
/// 8 KB is generous for analytics tags (cart_value / utm / device
/// flags) but blocks the "blob a 30 KB string into one key" abuse.
const PROPS_BYTES_MAX: usize = 8 * 1024;
const ROUTE_MAX: usize = 200;
const USER_ID_MAX: usize = 200;
const SESSION_ID_MAX: usize = 200;
const RELEASE_MAX: usize = 200;
const ENV_MAX: usize = 64;

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct TrackInput {
    #[validate(length(min = 1, max = 200))]
    pub name: String,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub ts: Option<OffsetDateTime>,
    #[serde(default)]
    pub props: BTreeMap<String, serde_json::Value>,
    pub user_id: Option<String>,
    pub session_id: Option<Uuid>,
    pub route: Option<String>,
    pub release: Option<String>,
    pub environment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub events: Vec<TrackInput>,
}

pub async fn handle_batch(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(req): Json<BatchRequest>,
) -> Response {
    if req.events.len() > MAX_BATCH {
        return batch_too_large(req.events.len());
    }

    let project_id = caller_project_id(&caller, &state);
    let Some(pool) = state.db.clone() else {
        return accepted_response(0, 0);
    };

    let mut accepted: u32 = 0;
    let mut skipped: u32 = 0;
    for ev in &req.events {
        if !is_valid_track_input(ev) {
            skipped += 1;
            continue;
        }
        match insert_track_event(&pool, project_id, ev).await {
            Ok(()) => accepted += 1,
            Err(()) => skipped += 1,
        }
    }

    tracing::info!(%project_id, accepted, skipped, "track batch accepted");
    accepted_response(accepted, skipped)
}

fn batch_too_large(actual: usize) -> Response {
    err_response_with(
        StatusCode::BAD_REQUEST,
        "track.batchTooLarge",
        format!("batch has {actual} events, cap is {MAX_BATCH}"),
        Some("split the batch client-side; the SDK flushes every 30s by default".to_string()),
        Some("https://sentori.golia.jp/docs/errors/track.batchTooLarge".to_string()),
        "domain.track",
        vec![],
    )
}

fn accepted_response(accepted: u32, skipped: u32) -> Response {
    (
        StatusCode::ACCEPTED,
        Json(json!({ "accepted": accepted, "skipped": skipped })),
    )
        .into_response()
}

/// Per-event validation. Centralised so the handler doesn't read like
/// an if-let cascade and so future cap changes only touch one place.
/// `session_id` is `Uuid` via serde so it doesn't need a length check;
/// `SESSION_ID_MAX` exists only as documentation for the column cap
/// if a future revision loosens the type.
fn is_valid_track_input(ev: &TrackInput) -> bool {
    if ev.validate().is_err() {
        return false;
    }
    if ev.props.len() > PROPS_KEYS_MAX {
        return false;
    }
    if props_byte_size(&ev.props) > PROPS_BYTES_MAX {
        return false;
    }
    let _ = SESSION_ID_MAX;
    str_in_range(ev.route.as_deref(), 1, ROUTE_MAX)
        && str_in_range(ev.user_id.as_deref(), 1, USER_ID_MAX)
        && str_in_range(ev.release.as_deref(), 1, RELEASE_MAX)
        && str_in_range(ev.environment.as_deref(), 1, ENV_MAX)
}

/// Cheap upper bound on the serialised JSONB. We can't avoid building
/// the JSON string at insert time anyway, so this overhead is paid
/// once on the validation pass and again on the actual encode; the
/// alternative (walking the `serde_json::Value` tree to estimate)
/// would double-count strings or under-count escape expansion.
fn props_byte_size(props: &BTreeMap<String, serde_json::Value>) -> usize {
    serde_json::to_vec(props).map(|v| v.len()).unwrap_or(0)
}

/// `None` → field absent (allowed). `Some` → must fit `[min, max]`.
fn str_in_range(value: Option<&str>, min: usize, max: usize) -> bool {
    match value {
        None => true,
        Some(s) => (min..=max).contains(&s.len()),
    }
}

async fn insert_track_event(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    ev: &TrackInput,
) -> Result<(), ()> {
    let id = Uuid::now_v7();
    let ts = ev.ts.unwrap_or_else(OffsetDateTime::now_utc);
    let props_json = serde_json::to_value(&ev.props)
        .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));
    let r = sqlx::query(
        "INSERT INTO track_events
            (id, project_id, name, user_id, session_id, route,
             release, environment, props, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(id)
    .bind(project_id)
    .bind(&ev.name)
    .bind(ev.user_id.as_deref())
    .bind(ev.session_id)
    .bind(ev.route.as_deref())
    .bind(ev.release.as_deref())
    .bind(ev.environment.as_deref())
    .bind(&props_json)
    .bind(ts)
    .execute(pool)
    .await;
    match r {
        Ok(_) => Ok(()),
        Err(e) => {
            tracing::error!(error = %e, "track insert failed");
            Err(())
        }
    }
}
