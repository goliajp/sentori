use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use axum::extract::FromRef;

use crate::auth::AuthState;
use crate::event::Event;

const MAX_RECENT: usize = 100;

/// In-memory ring buffer of the last N events received in this process's
/// lifetime. Backs the dev-only `GET /v1/events/_recent` endpoint used by
/// Phase 4 e2e smoke tests. Replaced by the persistent write path in Phase 5.
#[derive(Clone, Default)]
pub struct RecentBuffer {
    inner: Arc<Mutex<VecDeque<Event>>>,
}

impl RecentBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, event: Event) {
        let mut buf = self.inner.lock().expect("recent buffer poisoned");
        if buf.len() >= MAX_RECENT {
            buf.pop_front();
        }
        buf.push_back(event);
    }

    pub fn snapshot(&self) -> Vec<Event> {
        let buf = self.inner.lock().expect("recent buffer poisoned");
        buf.iter().cloned().collect()
    }
}

/// Phase 50 sub-A1 — broadcast tick fanned to every SSE subscriber
/// (`/admin/api/projects/{id}/events:stream`) on each ingested event.
/// `project_id` is included so a single broadcast channel serves
/// multi-project dashboards — clients filter on their own project.
#[derive(Clone, Debug)]
pub struct EventTick {
    pub kind: String,
    pub project_id: uuid::Uuid,
    pub ts_ms: i64,
}

#[derive(Clone)]
pub struct AppState {
    pub auth: AuthState,
    pub recent: RecentBuffer,
    pub db: Option<sqlx::PgPool>,
    pub valkey: Option<redis::aio::ConnectionManager>,
    pub project_id: uuid::Uuid,
    pub rate_limit_per_min: u32,
    pub admin_password: String,
    pub session_secret: String,
    pub notifier_tx: Option<tokio::sync::mpsc::Sender<crate::notifier::NotifyEvent>>,
    pub base_url: String,
    /// Phase 42 sub-C.02: pluggable storage for screenshots / view
    /// trees / state snapshots. When `SENTORI_ATTACHMENT_DIR` isn't
    /// set this is a `NoopAttachmentStore` and uploads return 503
    /// `attachmentsDisabled`.
    pub attachments: crate::attachments::SharedAttachmentStore,
    /// Phase 50 sub-A1: broadcast sender for the live event feed.
    /// 128-slot buffer; slow subscribers drop messages rather than
    /// back-pressure the ingest path. `Arc` shared so cloning AppState
    /// reuses the same channel.
    pub event_ticks: std::sync::Arc<tokio::sync::broadcast::Sender<EventTick>>,
    /// v0.9.3 +S7: live-debug stream — fans out the *full* event
    /// (not just a tick) to dashboard subscribers filtering by
    /// user_id. 32-slot buffer; same drop-on-slow semantics as ticks.
    pub live_events: std::sync::Arc<tokio::sync::broadcast::Sender<crate::event::Event>>,
    /// v0.8.0-d — optional GeoIP reader. `None` when
    /// `SENTORI_GEOIP_DB_PATH` isn't set or load failed; ingest just
    /// skips enrichment in that case.
    pub geoip: Option<crate::geoip::GeoIpReader>,
}

impl FromRef<AppState> for AuthState {
    fn from_ref(state: &AppState) -> Self {
        state.auth.clone()
    }
}

impl FromRef<AppState> for RecentBuffer {
    fn from_ref(state: &AppState) -> Self {
        state.recent.clone()
    }
}
