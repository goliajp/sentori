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

/// v0.9.3 +S7 (project_id added in v1.1 polish) — full event payload
/// broadcast to live-debug SSE subscribers. The pair `(project_id,
/// user_id)` is the dashboard filter key; without `project_id` two
/// projects with the same external `user.id` (an email, an auth0 sub)
/// would cross-leak each other's events.
#[derive(Clone)]
pub struct LiveEvent {
    pub project_id: uuid::Uuid,
    pub event: Event,
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
    /// (project_id, user_id). 32-slot buffer; same drop-on-slow
    /// semantics as ticks.
    pub live_events: std::sync::Arc<tokio::sync::broadcast::Sender<LiveEvent>>,
    /// v1.1 +S7 升级: per-user-id "live mode" flag with TTL. When
    /// dashboard arms a live session for user X, this map gets a
    /// (X → expires_at) entry. SDK polls `/v1/control/poll?userId=X`
    /// every ~30s and switches to immediate-send (no batching) while
    /// the flag is set. Map auto-purges expired entries on read.
    pub live_targets: std::sync::Arc<tokio::sync::RwLock<std::collections::HashMap<String, time::OffsetDateTime>>>,
    /// v0.8.0-d — optional GeoIP reader. `None` when
    /// `SENTORI_GEOIP_DB_PATH` isn't set or load failed; ingest just
    /// skips enrichment in that case.
    pub geoip: Option<crate::geoip::GeoIpReader>,
    /// v2.7 — shared outbound HTTP/2 client. Reused by every push
    /// provider (APNs, FCM, Web Push, HCM, MiPush) and by future
    /// outbound integrations (webhooks today still build their own;
    /// backfill is a follow-up). 5s connect / 10s read / HTTP/2 PK
    /// enabled by builder defaults.
    pub http_client: reqwest::Client,
    /// v2.19 — process-wide push provider registry. Same `Arc` lives
    /// inside `dispatch_cron::DispatchHandle`; sharing here lets the
    /// admin "verify credential" endpoint reuse FCM's OAuth token
    /// cache instead of re-minting on every dashboard refresh.
    pub push_providers: Option<Arc<crate::push::providers::Providers>>,
    /// v2.20 — process-wide push send-API gate. Per-token rate
    /// counter + payload/batch caps. Pulled in here so every public
    /// `/v1/push/*` send path can `state.send_gate.check_...` before
    /// touching the DB.
    pub send_gate: Arc<crate::push::send_gate::SendGate>,
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
