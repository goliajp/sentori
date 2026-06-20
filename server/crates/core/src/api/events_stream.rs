use std::convert::Infallible;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use tokio_stream::{wrappers::BroadcastStream, StreamExt};
use uuid::Uuid;

use crate::recent::{AppState, EventTick};

/// Phase 50 sub-A1 — `GET /admin/api/projects/{project_id}/events:stream`
///
/// Server-Sent Events feed of inbound event ticks scoped to one
/// project. Clients connect via the browser's native `EventSource`
/// (no websocket / library needed) and receive a line each time
/// `/v1/events` ingests something for that project. The payload is
/// the JSON-encoded `EventTick`:
///
///     {"projectId":"…","tsMs":1715683200000,"kind":"error"}
///
/// 15-second keep-alive comment so reverse proxies (Caddy / nginx)
/// don't kill the connection during idle stretches. Drops on the
/// broadcast side (slow subscriber) are silent — the dashboard's
/// rolling sparkline tolerates gaps.
pub async fn handle(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.event_ticks.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(move |res| match res {
        Ok(tick) if tick.project_id == project_id => Some(encode(tick)),
        // Drop ticks for other projects + lagged dropouts silently.
        _ => None,
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

fn encode(tick: EventTick) -> Result<Event, Infallible> {
    let json = serde_json::json!({
        "kind": tick.kind,
        "projectId": tick.project_id,
        "tsMs": tick.ts_ms,
    });
    Ok(Event::default().json_data(json).unwrap_or_default())
}
