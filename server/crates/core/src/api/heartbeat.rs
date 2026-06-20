// Analytics v1 — live-presence heartbeat ingest.
//
// `POST /v1/heartbeat` accepts a single foreground ping every ~60 s.
// We don't persist it to Postgres — concurrent-user readout reads
// straight from a Valkey ZSET keyed per project. The cost is one
// ZADD + one EXPIRE per call; per the iron rule the SDK's
// foreground-only / 1-per-minute cadence keeps this < 1 KB/min/user
// over the wire and < 1 ms of CPU on the server hot path.
//
// Auth + rate-limit inherit the same ingest middleware chain as
// `/v1/events`. No new auth shape required.

use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::live_presence;
use crate::recent::AppState;

const RELEASE_MAX: usize = 200;
const USER_ID_MAX: usize = 200;
const SESSION_ID_MAX: usize = 200;
const ROUTE_MAX: usize = 200;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Heartbeat {
    /// Stable session identifier — used as the presence-set member
    /// when the SDK hasn't called `setUser({ id })`.
    pub session_id: String,
    /// Application-defined user id when known. Preferred over
    /// `session_id` as the dedup key — one logged-in user looks like
    /// one concurrent regardless of how many tabs / app instances.
    pub user_id: Option<String>,
    pub release: String,
    /// Last navigation breadcrumb's `to` route. Optional — the SDK
    /// may not know the route on the first heartbeat after launch.
    pub route: Option<String>,
    /// `os osVersion` rendered string ("ios 17.4", "android 36"),
    /// for the Live dashboard's per-device breakdown. Optional.
    pub os: Option<String>,
    /// Caller's wall-clock ms. Server clamps if it diverges from
    /// system time by more than a generous window — protects against
    /// a wedged client clock dominating the ZSET.
    pub ts: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatAck {
    pub accepted_at: i64,
}

pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(body): Json<Heartbeat>,
) -> Response {
    if body.session_id.is_empty() || body.session_id.len() > SESSION_ID_MAX {
        return bad_request("invalidSessionId");
    }
    if let Some(uid) = &body.user_id {
        if uid.is_empty() || uid.len() > USER_ID_MAX {
            return bad_request("invalidUserId");
        }
    }
    if body.release.is_empty() || body.release.len() > RELEASE_MAX {
        return bad_request("invalidRelease");
    }
    if let Some(r) = &body.route {
        if r.len() > ROUTE_MAX {
            return bad_request("invalidRoute");
        }
    }

    let project_id = caller_project_id(&caller, &state);

    // Clamp client clock to wall ± 5 min so a wedged caller can't
    // post-date itself into the active window indefinitely. Older
    // ts → use the older value (will drop out of the window
    // naturally); newer → cap to wall.
    let now_ms = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)) as i64;
    let ts_ms = body.ts.min(now_ms + 5 * 60_000).max(now_ms - 5 * 60_000);

    let member = body
        .user_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(body.session_id.as_str());

    let mut valkey = match &state.valkey {
        Some(v) => v.clone(),
        None => {
            // Fail-open: no Valkey → still 202. Presence is best-effort.
            return ack(now_ms);
        }
    };

    // Country comes from server-side IP lookup; the SDK doesn't ship
    // a country code on heartbeat. Skipped at v1 — wire when geoip
    // is plumbed through this handler. Empty country means the Live
    // dashboard's byCountry row reads "—".
    let country: Option<&str> = None;
    let route = body.route.as_deref();
    let os = body.os.as_deref();

    if let Err(e) = live_presence::register(
        &mut valkey,
        &project_id,
        member,
        ts_ms,
        &body.release,
        route,
        os,
        country,
    )
    .await
    {
        tracing::error!(error = %e, %project_id, "heartbeat register failed; failing open");
        return ack(now_ms);
    }
    ack(now_ms)
}

fn ack(now_ms: i64) -> Response {
    (
        StatusCode::ACCEPTED,
        Json(HeartbeatAck { accepted_at: now_ms }),
    )
        .into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}

// Suppress the project_id-in-error lint: tests assert that we don't
// expose internal ids in the response shape.
#[allow(dead_code)]
fn _ensure_uuid_usage_for_lint(u: Uuid) -> Uuid {
    u
}
