// v2.23 — Per-(project, provider) invalid-token health gauge.
//
// Closes the remaining bullet under Provider-friendly ironclad rule #2
// ("invalid-token mass-send"). FCM, in particular, lowers the
// reputation of sender accounts that mass-send to tokens it has
// already revoked. Sustained 10 %+ invalid-rate is the threshold
// where their abuse heuristic kicks in. We watch the same signal
// proactively and auto-throttle ourselves before they do — strict
// dominance of being a quiet sender over being a blacklisted sender.
//
// Five outcome buckets per (project, kind), 5-minute rolling window,
// bucketed at 60 s for cheap O(1) update. The five outcomes:
//
//   - Sent           — provider accepted; healthy
//   - InvalidToken   — APNs BadDeviceToken / FCM UNREGISTERED /
//                      HCM 80200001 / etc. Triggers throttle when
//                      sustained.
//   - RateLimited    — provider 429. Already respected by smart
//                      retry; we count for the dashboard signal
//                      but do not throttle on it (separate dial).
//   - Timeout        — connect / request timeout. Counts toward the
//                      "noisy provider" signal but doesn't directly
//                      drive InvalidToken throttle.
//   - OtherTransient — transport / 5xx / unknown. Same as Timeout.
//
// `should_auto_throttle` is true when `invalid_count / total >= 0.10`
// AND `total >= 20` (avoid throttling on a few unlucky retries).
//
// Per-process only. Multi-instance share is v2.38 territory.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use uuid::Uuid;

use super::providers::ProviderKind;
use super::token_cache::{Clock, RealClock};

/// Window the rolling counters span.
pub const HEALTH_WINDOW: Duration = Duration::from_secs(5 * 60);

/// One bucket = 60 s of counts. 5 buckets ≈ HEALTH_WINDOW.
const BUCKET_DURATION: Duration = Duration::from_secs(60);

/// Auto-throttle threshold: at least this fraction of in-window
/// sends must be `InvalidToken` to fire.
pub const AUTO_THROTTLE_INVALID_RATIO: f64 = 0.10;

/// Minimum in-window send count before auto-throttle is considered.
/// Avoids "5 out of 10 invalid -> throttle" panic on tiny samples.
pub const AUTO_THROTTLE_MIN_SENDS: u32 = 20;

/// What kind of outcome occurred, in the categorisation HealthState
/// cares about. Maps one-to-many from `SendOutcome` (multiple
/// provider classifications collapse into one bucket — e.g. APNs
/// `BadDeviceToken` and `Unregistered` both flow into `InvalidToken`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthOutcome {
    Sent,
    InvalidToken,
    RateLimited,
    Timeout,
    OtherTransient,
}

#[derive(Default, Clone, Copy)]
struct Counts {
    sent: u32,
    invalid: u32,
    rate_limited: u32,
    timeout: u32,
    other_transient: u32,
}

impl Counts {
    fn total(&self) -> u32 {
        self.sent + self.invalid + self.rate_limited + self.timeout + self.other_transient
    }
    fn add(&mut self, outcome: HealthOutcome) {
        match outcome {
            HealthOutcome::Sent => self.sent += 1,
            HealthOutcome::InvalidToken => self.invalid += 1,
            HealthOutcome::RateLimited => self.rate_limited += 1,
            HealthOutcome::Timeout => self.timeout += 1,
            HealthOutcome::OtherTransient => self.other_transient += 1,
        }
    }
    fn merge(&mut self, other: &Counts) {
        self.sent += other.sent;
        self.invalid += other.invalid;
        self.rate_limited += other.rate_limited;
        self.timeout += other.timeout;
        self.other_transient += other.other_transient;
    }
}

struct RollingBuckets {
    /// `(bucket_start, counts)`. Kept sorted-by-time. New entries push
    /// to the back; old entries drop from the front on each `record`.
    /// `bucket_start` is the start of the 60 s bucket.
    buckets: Vec<(Instant, Counts)>,
}

impl RollingBuckets {
    fn new() -> Self {
        Self {
            buckets: Vec::new(),
        }
    }

    fn window_counts(&self, now: Instant) -> Counts {
        let cutoff = now.checked_sub(HEALTH_WINDOW).unwrap_or(now);
        let mut total = Counts::default();
        for (t, c) in &self.buckets {
            if *t >= cutoff {
                total.merge(c);
            }
        }
        total
    }
}

/// Per-process health state. Keyed by `(project_id, ProviderKind)`.
pub struct HealthState<C: Clock = RealClock> {
    inner: Mutex<HashMap<(Uuid, ProviderKind), RollingBuckets>>,
    clock: Arc<C>,
}

impl HealthState<RealClock> {
    pub fn new() -> Self {
        Self::with_clock(Arc::new(RealClock))
    }
}

impl Default for HealthState<RealClock> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: Clock> HealthState<C> {
    pub fn with_clock(clock: Arc<C>) -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            clock,
        }
    }

    /// Record one dispatch attempt's outcome for `(project, kind)`.
    /// O(1) amortised — at worst drops a few stale buckets.
    pub async fn record(&self, project: Uuid, kind: ProviderKind, outcome: HealthOutcome) {
        let now = self.clock.now();
        let mut map = self.inner.lock().await;
        let buckets = map
            .entry((project, kind))
            .or_insert_with(RollingBuckets::new);
        // Use last_bucket_start ordering: if the current bucket is
        // within BUCKET_DURATION of the latest, merge; else open a
        // new bucket.
        if let Some((t, c)) = buckets.buckets.last_mut() {
            if now.saturating_duration_since(*t) < BUCKET_DURATION {
                c.add(outcome);
                // Drop any pre-window buckets.
                let cutoff = now.checked_sub(HEALTH_WINDOW).unwrap_or(now);
                buckets.buckets.retain(|(t, _)| *t >= cutoff);
                return;
            }
        }
        let mut c = Counts::default();
        c.add(outcome);
        buckets.buckets.push((now, c));
        let cutoff = now.checked_sub(HEALTH_WINDOW).unwrap_or(now);
        buckets.buckets.retain(|(t, _)| *t >= cutoff);
    }

    /// Fraction of in-window sends that were `InvalidToken`. Returns
    /// 0.0 when there are no in-window samples.
    pub async fn invalid_rate(&self, project: Uuid, kind: ProviderKind) -> f64 {
        let now = self.clock.now();
        let map = self.inner.lock().await;
        let Some(buckets) = map.get(&(project, kind)) else {
            return 0.0;
        };
        let counts = buckets.window_counts(now);
        let total = counts.total();
        if total == 0 {
            0.0
        } else {
            counts.invalid as f64 / total as f64
        }
    }

    /// Total in-window send count. Useful for thresholding and tests.
    pub async fn in_window_total(&self, project: Uuid, kind: ProviderKind) -> u32 {
        let now = self.clock.now();
        let map = self.inner.lock().await;
        let Some(buckets) = map.get(&(project, kind)) else {
            return 0;
        };
        buckets.window_counts(now).total()
    }

    /// True when invalid-rate threshold tripped AND sample size is
    /// large enough to act on. Caller decides what to do (typically
    /// `tracing::warn!` + tighten `RateLimiter` for this target).
    pub async fn should_auto_throttle(&self, project: Uuid, kind: ProviderKind) -> bool {
        let now = self.clock.now();
        let map = self.inner.lock().await;
        let Some(buckets) = map.get(&(project, kind)) else {
            return false;
        };
        let counts = buckets.window_counts(now);
        let total = counts.total();
        if total < AUTO_THROTTLE_MIN_SENDS {
            return false;
        }
        let invalid_rate = counts.invalid as f64 / total as f64;
        invalid_rate >= AUTO_THROTTLE_INVALID_RATIO
    }

    /// v2.37 — aggregate `Counts` across all projects for `kind`.
    /// Used by the global-circuit-breaker decision below.
    async fn global_counts(&self, kind: ProviderKind) -> Counts {
        let now = self.clock.now();
        let map = self.inner.lock().await;
        let mut total = Counts::default();
        for ((_, k), buckets) in map.iter() {
            if *k == kind {
                total.merge(&buckets.window_counts(now));
            }
        }
        total
    }

    /// v2.37 — fraction of all in-window sends to `kind` that hit a
    /// transient-failure bucket (RateLimited / Timeout /
    /// OtherTransient). Reported for observability + the dashboard
    /// hook the Insight team asked for.
    pub async fn global_transient_rate(&self, kind: ProviderKind) -> f64 {
        let counts = self.global_counts(kind).await;
        let total = counts.total();
        if total == 0 {
            return 0.0;
        }
        let bad = counts.rate_limited + counts.timeout + counts.other_transient;
        bad as f64 / total as f64
    }

    /// v2.37 — true when the GLOBAL transient rate (across every
    /// project sending through `kind`) crosses
    /// [`GLOBAL_THROTTLE_TRANSIENT_RATIO`] AND the sample is large
    /// enough to act on. When this fires the caller dials L1 down
    /// for the whole provider so APNs / FCM gets a chance to
    /// breathe. Independent from `should_auto_throttle` which is
    /// per-(project, kind) and watches `InvalidToken` specifically.
    pub async fn should_global_throttle(&self, kind: ProviderKind) -> bool {
        let counts = self.global_counts(kind).await;
        let total = counts.total();
        if total < GLOBAL_THROTTLE_MIN_SENDS {
            return false;
        }
        let bad = counts.rate_limited + counts.timeout + counts.other_transient;
        let rate = bad as f64 / total as f64;
        rate >= GLOBAL_THROTTLE_TRANSIENT_RATIO
    }
}

/// v2.37 — global-circuit-breaker threshold. When the aggregate
/// transient rate across every project on a provider crosses this in
/// the rolling window, the entire provider's L1 bucket dials down.
pub const GLOBAL_THROTTLE_TRANSIENT_RATIO: f64 = 0.20;

/// v2.37 — minimum aggregate sample size before global throttle can
/// fire. A handful of unlucky retries shouldn't take everyone down.
pub const GLOBAL_THROTTLE_MIN_SENDS: u32 = 50;

#[cfg(test)]
mod tests {
    use std::sync::Mutex as StdMutex;

    use super::*;

    struct MockClock {
        t: StdMutex<Instant>,
    }

    impl MockClock {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                t: StdMutex::new(Instant::now()),
            })
        }
        fn advance(&self, by: Duration) {
            let mut g = self.t.lock().unwrap();
            *g += by;
        }
    }

    impl Clock for MockClock {
        fn now(&self) -> Instant {
            *self.t.lock().unwrap()
        }
    }

    fn proj() -> Uuid {
        Uuid::now_v7()
    }

    #[tokio::test]
    async fn empty_state_returns_zero_rate() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let p = proj();
        assert_eq!(h.invalid_rate(p, ProviderKind::Apns).await, 0.0);
        assert_eq!(h.in_window_total(p, ProviderKind::Apns).await, 0);
        assert!(!h.should_auto_throttle(p, ProviderKind::Apns).await);
    }

    #[tokio::test]
    async fn record_counts_correctly() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let p = proj();
        for _ in 0..18 {
            h.record(p, ProviderKind::Apns, HealthOutcome::Sent).await;
        }
        for _ in 0..2 {
            h.record(p, ProviderKind::Apns, HealthOutcome::InvalidToken).await;
        }
        assert_eq!(h.in_window_total(p, ProviderKind::Apns).await, 20);
        let r = h.invalid_rate(p, ProviderKind::Apns).await;
        assert!((r - 0.10).abs() < 1e-9, "expected ~0.10, got {r}");
    }

    #[tokio::test]
    async fn auto_throttle_requires_minimum_sample_size() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let p = proj();
        // 5 invalid out of 5 = 100% — but sample size < 20.
        for _ in 0..5 {
            h.record(p, ProviderKind::Apns, HealthOutcome::InvalidToken).await;
        }
        assert!(!h.should_auto_throttle(p, ProviderKind::Apns).await);
    }

    #[tokio::test]
    async fn auto_throttle_fires_at_threshold() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let p = proj();
        // 18 sent + 2 invalid = 10 % at N=20 — exactly threshold.
        for _ in 0..18 {
            h.record(p, ProviderKind::Apns, HealthOutcome::Sent).await;
        }
        for _ in 0..2 {
            h.record(p, ProviderKind::Apns, HealthOutcome::InvalidToken).await;
        }
        assert!(h.should_auto_throttle(p, ProviderKind::Apns).await);
    }

    #[tokio::test]
    async fn auto_throttle_does_not_fire_under_threshold() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let p = proj();
        // 19 sent + 1 invalid = 5 % at N=20.
        for _ in 0..19 {
            h.record(p, ProviderKind::Apns, HealthOutcome::Sent).await;
        }
        h.record(p, ProviderKind::Apns, HealthOutcome::InvalidToken).await;
        assert!(!h.should_auto_throttle(p, ProviderKind::Apns).await);
    }

    #[tokio::test]
    async fn projects_isolated() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let a = proj();
        let b = proj();
        for _ in 0..50 {
            h.record(a, ProviderKind::Apns, HealthOutcome::InvalidToken).await;
        }
        assert!(h.should_auto_throttle(a, ProviderKind::Apns).await);
        assert!(!h.should_auto_throttle(b, ProviderKind::Apns).await);
    }

    #[tokio::test]
    async fn providers_isolated() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let p = proj();
        for _ in 0..50 {
            h.record(p, ProviderKind::Apns, HealthOutcome::InvalidToken).await;
        }
        assert!(h.should_auto_throttle(p, ProviderKind::Apns).await);
        assert!(!h.should_auto_throttle(p, ProviderKind::Fcm).await);
    }

    #[tokio::test]
    async fn old_buckets_drop_out_of_window() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock.clone());
        let p = proj();
        // Fill with 100 % invalid at time t=0.
        for _ in 0..50 {
            h.record(p, ProviderKind::Apns, HealthOutcome::InvalidToken).await;
        }
        assert!(h.should_auto_throttle(p, ProviderKind::Apns).await);
        // Advance past the window.
        clock.advance(HEALTH_WINDOW + Duration::from_secs(1));
        // Force a re-evaluation by recording one healthy send. The
        // stale 50 invalids should be dropped on the record() prune.
        h.record(p, ProviderKind::Apns, HealthOutcome::Sent).await;
        assert!(!h.should_auto_throttle(p, ProviderKind::Apns).await);
        assert_eq!(h.in_window_total(p, ProviderKind::Apns).await, 1);
    }

    #[tokio::test]
    async fn global_throttle_aggregates_across_projects() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        // Three projects, each contributing 20 sends to APNs.
        // 8 transient / 12 sent per project → 60 sent, 24 transient =
        // 28.5% > 20% threshold across 60 samples > 50 min.
        for _ in 0..3 {
            let p = proj();
            for _ in 0..12 {
                h.record(p, ProviderKind::Apns, HealthOutcome::Sent).await;
            }
            for _ in 0..8 {
                h.record(p, ProviderKind::Apns, HealthOutcome::RateLimited)
                    .await;
            }
        }
        assert!(h.should_global_throttle(ProviderKind::Apns).await);
        // Other providers untouched.
        assert!(!h.should_global_throttle(ProviderKind::Fcm).await);
        let rate = h.global_transient_rate(ProviderKind::Apns).await;
        assert!(rate > 0.39 && rate < 0.41, "expected ~40%, got {rate}");
    }

    #[tokio::test]
    async fn global_throttle_requires_minimum_sample_size() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        // 100 % transient but only 30 samples — well above
        // GLOBAL_THROTTLE_MIN_SENDS=50 minimum? No, 30 < 50.
        let p = proj();
        for _ in 0..30 {
            h.record(p, ProviderKind::Apns, HealthOutcome::RateLimited)
                .await;
        }
        assert!(!h.should_global_throttle(ProviderKind::Apns).await);
    }

    #[tokio::test]
    async fn global_throttle_does_not_fire_on_healthy_aggregate() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        // 60 sends, 6 transient = 10 % — under threshold.
        let p = proj();
        for _ in 0..54 {
            h.record(p, ProviderKind::Apns, HealthOutcome::Sent).await;
        }
        for _ in 0..6 {
            h.record(p, ProviderKind::Apns, HealthOutcome::Timeout)
                .await;
        }
        assert!(!h.should_global_throttle(ProviderKind::Apns).await);
    }

    #[tokio::test]
    async fn invalid_rate_does_not_count_other_outcomes() {
        let clock = MockClock::new();
        let h: HealthState<MockClock> = HealthState::with_clock(clock);
        let p = proj();
        // 18 sent + 1 RateLimited + 1 Timeout = 20 total, 0 invalid.
        for _ in 0..18 {
            h.record(p, ProviderKind::Apns, HealthOutcome::Sent).await;
        }
        h.record(p, ProviderKind::Apns, HealthOutcome::RateLimited).await;
        h.record(p, ProviderKind::Apns, HealthOutcome::Timeout).await;
        assert_eq!(h.invalid_rate(p, ProviderKind::Apns).await, 0.0);
        assert!(!h.should_auto_throttle(p, ProviderKind::Apns).await);
    }
}
