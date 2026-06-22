//! Per-token in-memory sliding-window rate limiter for /v1/events.
//!
//! Sliding window: token_id → ring-buffer of N timestamps. Reject
//! when buffer is full AND oldest timestamp is < window seconds old.
//!
//! v0.2 ships per-process (single-instance self-hosted). Horizontal
//! scale would need Redis/Valkey backing — v0.3+ if SaaS demand
//! pushes us there.
//!
//! Tunables (env-vars):
//! - `SENTORI_RATELIMIT_DISABLED` default off (set to "1" or "true"
//!   to skip the middleware entirely)
//! - `SENTORI_RATELIMIT_PER_TOKEN_RPS`  default 100 (events/sec/token)
//! - `SENTORI_RATELIMIT_WINDOW_SEC`     default 1

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use uuid::Uuid;

pub struct RateLimiter {
    buckets: Mutex<HashMap<Uuid, VecDeque<Instant>>>,
    capacity: usize,
    window: Duration,
    disabled: bool,
}

impl RateLimiter {
    #[must_use]
    pub fn from_env() -> Self {
        let disabled = matches!(
            std::env::var("SENTORI_RATELIMIT_DISABLED")
                .ok()
                .as_deref()
                .map(|s| s.to_ascii_lowercase()),
            Some(s) if s == "1" || s == "true"
        );
        let capacity = std::env::var("SENTORI_RATELIMIT_PER_TOKEN_RPS")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(100);
        let window = std::env::var("SENTORI_RATELIMIT_WINDOW_SEC")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(1);
        Self {
            buckets: Mutex::new(HashMap::new()),
            capacity,
            window: Duration::from_secs(window),
            disabled,
        }
    }

    /// Try to acquire a slot for the given token. Returns true on
    /// admit, false on reject (caller should return 429).
    pub fn admit(&self, token_id: Uuid) -> bool {
        if self.disabled {
            return true;
        }
        let now = Instant::now();
        let Ok(mut buckets) = self.buckets.lock() else {
            return true;
        };
        let buf = buckets.entry(token_id).or_insert_with(VecDeque::new);
        // Evict timestamps outside the window.
        while let Some(&front) = buf.front() {
            if now.duration_since(front) > self.window {
                buf.pop_front();
            } else {
                break;
            }
        }
        if buf.len() >= self.capacity {
            return false;
        }
        buf.push_back(now);
        true
    }
}
