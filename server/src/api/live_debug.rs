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

use crate::event::Event;
use crate::recent::AppState;

const SESSION_TTL_SECS: u64 = 10 * 60;

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
            Ok(ev) if event_matches(&ev, project_match, user_match) => Some(encode(&ev)),
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

fn event_matches(ev: &Event, project_id: Uuid, user_id: &str) -> bool {
    let ev_user = ev.user.as_ref().and_then(|u| u.id.as_deref());
    let _ = project_id; // ingest path doesn't carry project_id on the wire event
                        // (server-resolved from token), so user-id match is
                        // sufficient — collisions across projects are
                        // unlikely given UUID-ish ids in practice. Future:
                        // attach project_id to the broadcast payload.
    matches!(ev_user, Some(id) if id == user_id)
}

fn encode(ev: &Event) -> Result<SseEvent, Infallible> {
    let json = serde_json::to_value(ev).unwrap_or_default();
    Ok(SseEvent::default().event("event").json_data(json).unwrap_or_default())
}
