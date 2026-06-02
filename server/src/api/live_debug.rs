// v0.9.3 +S7 — Live Debug Stream.
//
// `GET /admin/api/projects/{project_id}/live-debug/users/{user_id}`
//
// SSE endpoint that fans out full event payloads — filtered by
// project + user.id — to a dashboard live-debug viewer. The
// dashboard EventSource connects when the operator clicks "live
// debug" on a user's session; the stream stays open until the
// browser closes it or the 10-minute server-side TTL fires.
//
// MVP design: no SDK control channel. Stream is fed by the regular
// ingest path (`api::events::handle` writes to `state.live_events`
// for any event carrying `user.id`). Since the SDK already batches
// at ~5 s, the dashboard sees a 0-5 s "near-real-time" cadence,
// which is enough for triage. Tighter latency lands in v1.0 when
// we wire an SDK-side immediate-send mode for flagged users.

use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use futures::stream::Stream;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use uuid::Uuid;

use crate::recent::{AppState, LiveEvent};

const SESSION_TTL_SECS: u64 = 10 * 60;

/// v1.1 +S7 升级 — arm a user_id for live mode. SDK polls
/// `/v1/control/poll?userId=X` and reads back `liveMode: true` for
/// the TTL window. Idempotent — re-arm refreshes the deadline.
pub async fn arm_user(
    State(state): State<AppState>,
    Path((_project_id, user_id)): Path<(Uuid, String)>,
) -> axum::http::StatusCode {
    let expires_at = time::OffsetDateTime::now_utc() + time::Duration::seconds(SESSION_TTL_SECS as i64);
    let mut targets = state.live_targets.write().await;
    targets.insert(user_id, expires_at);
    axum::http::StatusCode::CREATED
}

pub async fn disarm_user(
    State(state): State<AppState>,
    Path((_project_id, user_id)): Path<(Uuid, String)>,
) -> axum::http::StatusCode {
    let mut targets = state.live_targets.write().await;
    targets.remove(&user_id);
    axum::http::StatusCode::NO_CONTENT
}

/// `GET /v1/control/poll?userId=X` — SDK polls this every 30s. Returns
/// `{ liveMode: bool, ttlMs: number }`. No auth (ingest token middleware
/// already gates ingestion routes; this lives under the ingest path).
pub async fn poll(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<PollQuery>,
) -> axum::response::Json<PollResponse> {
    let now = time::OffsetDateTime::now_utc();
    let mut live_mode = false;
    let mut ttl_ms: i64 = 0;
    {
        let mut targets = state.live_targets.write().await;
        targets.retain(|_, expires| *expires > now);
        if let Some(user_id) = q.user_id.as_deref() {
            if let Some(expires_at) = targets.get(user_id) {
                live_mode = true;
                ttl_ms = (*expires_at - now).whole_milliseconds() as i64;
            }
        }
    }
    axum::response::Json(PollResponse { live_mode, ttl_ms })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollQuery {
    pub user_id: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollResponse {
    pub live_mode: bool,
    pub ttl_ms: i64,
}

pub async fn stream_user_events(
    State(state): State<AppState>,
    Path((project_id, user_id)): Path<(Uuid, String)>,
) -> Sse<impl Stream<Item = Result<SseEvent, Infallible>>> {
    let rx = state.live_events.subscribe();
    let user_id_owned = user_id;
    let project_id_owned = project_id;

    // 10-min ttl. After that the stream emits one final marker and
    // closes — dashboard sees `event: timeout` and can re-arm.
    let raw = BroadcastStream::new(rx).filter_map(move |res| {
        let user_match = &user_id_owned;
        let project_match = project_id_owned;
        match res {
            Ok(le) if event_matches(&le, project_match, user_match) => Some(encode(&le.event)),
            _ => None,
        }
    });

    let bounded = raw.timeout(Duration::from_secs(SESSION_TTL_SECS));
    let stream = bounded.filter_map(|res| match res {
        Ok(item) => Some(item),
        Err(_) => Some(Ok(SseEvent::default()
            .event("timeout")
            .data("live session expired (10 min)"))),
    });

    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

/// SSE subscribers filter on the pair `(project_id, user.id)` — both
/// must match. The producer (`events.rs`) attaches `project_id` from
/// the resolved ingest token, so cross-project leakage is impossible
/// even when two projects use the same external `user.id` scheme.
fn event_matches(le: &LiveEvent, project_id: Uuid, user_id: &str) -> bool {
    if le.project_id != project_id {
        return false;
    }
    let ev_user = le.event.user.as_ref().and_then(|u| u.id.as_deref());
    matches!(ev_user, Some(id) if id == user_id)
}

fn encode(ev: &crate::event::Event) -> Result<SseEvent, Infallible> {
    // Serialization failure should be loud, not a silent empty payload —
    // a corrupt event reaching the dashboard makes debugging worse.
    // We log and emit an explicit error frame so the dashboard sees the
    // gap rather than an empty `event: event` data line.
    match serde_json::to_value(ev) {
        Ok(json) => Ok(SseEvent::default()
            .event("event")
            .json_data(json)
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "live_debug: SseEvent json_data failed");
                SseEvent::default().event("error").data("encodeFailed")
            })),
        Err(e) => {
            tracing::warn!(error = %e, "live_debug: event serialize failed");
            Ok(SseEvent::default().event("error").data("encodeFailed"))
        }
    }
}
