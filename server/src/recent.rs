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
