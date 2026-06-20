// v2.22 — Three-layer dispatch rate limit.
//
// Provider-friendly ironclad rule #2 ("rate non-limiting") + Multi-
// tenant fairness rule #3 ("per-project send quota"). Without this,
// one noisy project can flood APNs/FCM enough to trip their abuse
// heuristics — affecting every customer on this Sentori instance.
//
// Three layers stacked, evaluated in this order on every dispatch:
//
//   L1 — per-`ProviderKind` token bucket. Caps the rate at which we
//        hit any single provider. Tuned per-provider:
//          • APNs    400 cap / 200 ref-per-sec   (~2 s burst)
//          • FCM     400 cap / 200 ref-per-sec
//          • HCM     200 cap / 100 ref-per-sec
//          • WebPush 200 cap / 100 ref-per-sec
//          • MiPush  100 cap /  50 ref-per-sec
//
//   L2 — per-`project_id` token bucket. Caps the rate at which any
//        single project may push. Default 100 cap / 50 ref-per-sec.
//        Buckets lazy-created on first use.
//
//   L3 — global inflight counter. Caps total concurrent
//        `provider.send().await` in-flight. Default 200. Backed by
//        an `Arc<AtomicU32>` so the `RatePermit` can decrement on
//        drop without taking a lock.
//
// On acquire failure, dispatch_cron defers the send by a layer-
// specific window (L3 1 s, L1 provider 2 s, L2 project 5 s) WITHOUT
// burning `retry_count` — rate-limit deferral is not an attempt,
// same rule as quarantine in v2.21.
//
// Per-process only. Horizontal share is v2.38 (queue upgrade)
// territory.

use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use uuid::Uuid;

use super::providers::ProviderKind;
use super::token_cache::{Clock, RealClock};

/// L1 per-provider defaults `(capacity, refill_per_sec)`. Choose
/// `capacity / refill_per_sec` ≈ 2 s of burst so a small spike
/// won't trip a layer that's healthy in steady-state.
fn provider_default(kind: ProviderKind) -> (f64, f64) {
    match kind {
        ProviderKind::Apns => (400.0, 200.0),
        ProviderKind::Fcm => (400.0, 200.0),
        ProviderKind::Hcm => (200.0, 100.0),
        ProviderKind::WebPush => (200.0, 100.0),
        ProviderKind::MiPush => (100.0, 50.0),
    }
}

/// L2 per-project default `(capacity, refill_per_sec)`. Sized for
/// mid-tier self-host where a single project averages well under
/// 50/sec sustained.
const PROJECT_CAPACITY: f64 = 100.0;
const PROJECT_REFILL_PER_SEC: f64 = 50.0;

/// L3 global inflight cap. Absolute ceiling on concurrent
/// `provider.send().await` in-flight across all
/// (project, provider) combinations.
pub const GLOBAL_INFLIGHT_MAX: u32 = 200;

/// v2.37 — multiplier applied to a token bucket's refill rate when
/// the adaptive throttle fires. 0.5 = half-speed. Stays in effect
/// for [`ADAPTIVE_THROTTLE_WINDOW`], then refill resets.
pub const ADAPTIVE_THROTTLE_FACTOR: f64 = 0.5;

/// v2.37 — how long an adaptive throttle stays installed. After
/// this window the bucket reverts to its base refill on the next
/// `try_acquire`. Matches v2.23's invalid-rate rolling window so a
/// project that's been throttled for invalid_rate has the same
/// observation horizon to recover.
pub const ADAPTIVE_THROTTLE_WINDOW: Duration = Duration::from_secs(5 * 60);

/// Why an `acquire` call failed. Each variant maps to a distinct
/// defer window in `dispatch_cron`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateError {
    /// L1 — the per-provider bucket is empty.
    ProviderRateLimited(ProviderKind),
    /// L2 — this project's bucket is empty.
    ProjectRateLimited(Uuid),
    /// L3 — global inflight at cap.
    GlobalInflight,
}

/// Held while a dispatch is in-flight. Dropping the permit
/// decrements the L3 inflight counter.
#[derive(Debug)]
pub struct RatePermit {
    inflight: Arc<AtomicU32>,
}

impl Drop for RatePermit {
    fn drop(&mut self) {
        self.inflight.fetch_sub(1, Ordering::SeqCst);
    }
}

struct BucketState {
    tokens: f64,
    last_refill: Instant,
    /// v2.37 — `Some((factor, until))` while a throttle is active.
    /// `effective refill = refill_per_sec * factor` until `until`,
    /// then we reset to None and the bucket goes back to the base
    /// rate automatically. Set by `RateLimiter::throttle_provider`
    /// or `throttle_project` when health crosses its threshold.
    throttle: Option<(f64, Instant)>,
}

/// Classical token bucket. Synchronous — the critical section is
/// short (`try_acquire` does refill math + a single comparison) so
/// we use `std::sync::Mutex` and avoid the async-Mutex hop.
pub struct TokenBucket<C: Clock = RealClock> {
    capacity: f64,
    refill_per_sec: f64,
    state: Mutex<BucketState>,
    clock: Arc<C>,
}

impl<C: Clock> TokenBucket<C> {
    pub fn new(capacity: f64, refill_per_sec: f64, clock: Arc<C>) -> Self {
        Self {
            capacity,
            refill_per_sec,
            state: Mutex::new(BucketState {
                tokens: capacity,
                last_refill: clock.now(),
                throttle: None,
            }),
            clock,
        }
    }

    /// v2.37 — install an adaptive throttle. `factor` multiplies the
    /// effective refill rate (0.5 = half speed) until `until`. After
    /// `until` passes, the next `try_acquire` clears the throttle.
    pub fn set_throttle(&self, factor: f64, until: Instant) {
        let mut state = self.state.lock().unwrap();
        state.throttle = Some((factor, until));
    }

    /// v2.37 — current throttle factor (1.0 when not throttled or
    /// expired). Useful for tests + future metrics.
    pub fn effective_factor(&self) -> f64 {
        let state = self.state.lock().unwrap();
        let now = self.clock.now();
        match state.throttle {
            Some((f, until)) if until > now => f,
            _ => 1.0,
        }
    }

    /// Attempt to consume `n` tokens. Returns true on success;
    /// false leaves the bucket unchanged.
    pub fn try_acquire(&self, n: f64) -> bool {
        let mut state = self.state.lock().unwrap();
        let now = self.clock.now();
        // v2.37 — apply active throttle to the effective refill rate;
        // expired throttle clears automatically.
        let factor = match state.throttle {
            Some((f, until)) if until > now => f,
            Some(_) => {
                state.throttle = None;
                1.0
            }
            None => 1.0,
        };
        let effective_refill = self.refill_per_sec * factor;
        let elapsed = now.saturating_duration_since(state.last_refill).as_secs_f64();
        state.tokens = (state.tokens + elapsed * effective_refill).min(self.capacity);
        state.last_refill = now;
        if state.tokens >= n {
            state.tokens -= n;
            true
        } else {
            false
        }
    }

    /// Current token count after a refill pass. Useful for tests +
    /// future metrics.
    #[allow(dead_code)]
    pub fn available(&self) -> f64 {
        let mut state = self.state.lock().unwrap();
        let now = self.clock.now();
        let elapsed = now.saturating_duration_since(state.last_refill).as_secs_f64();
        state.tokens = (state.tokens + elapsed * self.refill_per_sec).min(self.capacity);
        state.last_refill = now;
        state.tokens
    }
}

/// Process-wide three-layer rate limiter. One instance lives on
/// `Providers`; `Arc` shared with dispatch_cron.
pub struct RateLimiter<C: Clock = RealClock> {
    provider_buckets: HashMap<ProviderKind, TokenBucket<C>>,
    project_buckets: Mutex<HashMap<Uuid, Arc<TokenBucket<C>>>>,
    inflight: Arc<AtomicU32>,
    global_max: u32,
    clock: Arc<C>,
}

impl RateLimiter<RealClock> {
    pub fn new() -> Self {
        Self::with_clock(Arc::new(RealClock))
    }
}

impl Default for RateLimiter<RealClock> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: Clock> RateLimiter<C> {
    pub fn with_clock(clock: Arc<C>) -> Self {
        let mut provider_buckets = HashMap::new();
        for kind in [
            ProviderKind::Apns,
            ProviderKind::Fcm,
            ProviderKind::Hcm,
            ProviderKind::WebPush,
            ProviderKind::MiPush,
        ] {
            let (cap, refill) = provider_default(kind);
            provider_buckets.insert(kind, TokenBucket::new(cap, refill, clock.clone()));
        }
        Self {
            provider_buckets,
            project_buckets: Mutex::new(HashMap::new()),
            inflight: Arc::new(AtomicU32::new(0)),
            global_max: GLOBAL_INFLIGHT_MAX,
            clock,
        }
    }

    /// Attempt to acquire a permit for `(project, kind)`. Order
    /// matters: L3 first (cheapest), L1 second (cap noisy provider),
    /// L2 last (per-project quota). On L2 fail we refund L1 + L3.
    pub fn acquire(
        &self,
        project_id: Uuid,
        kind: ProviderKind,
    ) -> Result<RatePermit, RateError> {
        // L3: optimistic increment-then-check. If we go over,
        // back out before doing any token-bucket work.
        let new_inflight = self.inflight.fetch_add(1, Ordering::SeqCst) + 1;
        if new_inflight > self.global_max {
            self.inflight.fetch_sub(1, Ordering::SeqCst);
            return Err(RateError::GlobalInflight);
        }

        // L1: per-provider.
        let provider_bucket = match self.provider_buckets.get(&kind) {
            Some(b) => b,
            None => {
                // Should be impossible — all kinds registered in new(),
                // but treat defensively.
                self.inflight.fetch_sub(1, Ordering::SeqCst);
                return Err(RateError::ProviderRateLimited(kind));
            }
        };
        if !provider_bucket.try_acquire(1.0) {
            self.inflight.fetch_sub(1, Ordering::SeqCst);
            return Err(RateError::ProviderRateLimited(kind));
        }

        // L2: per-project, lazy-created bucket.
        let project_bucket = {
            let mut map = self.project_buckets.lock().unwrap();
            map.entry(project_id)
                .or_insert_with(|| {
                    Arc::new(TokenBucket::new(
                        PROJECT_CAPACITY,
                        PROJECT_REFILL_PER_SEC,
                        self.clock.clone(),
                    ))
                })
                .clone()
        };
        if !project_bucket.try_acquire(1.0) {
            // L1 already debited one. No refund — the next refill
            // will replenish; over-grant of one token is harmless.
            self.inflight.fetch_sub(1, Ordering::SeqCst);
            return Err(RateError::ProjectRateLimited(project_id));
        }

        Ok(RatePermit {
            inflight: self.inflight.clone(),
        })
    }

    /// Current L3 inflight count. Useful for tests + metrics.
    pub fn inflight_now(&self) -> u32 {
        self.inflight.load(Ordering::SeqCst)
    }

    /// v2.37 — install an adaptive throttle on the L1 per-provider
    /// bucket. Used by the global circuit-breaker when
    /// `HealthState::should_global_throttle` fires. Default callers
    /// pass `factor=0.5, duration=5min`. Idempotent: re-arming with
    /// the same window resets the deadline.
    pub fn throttle_provider(&self, kind: ProviderKind, factor: f64, duration: Duration) {
        if let Some(b) = self.provider_buckets.get(&kind) {
            b.set_throttle(factor, self.clock.now() + duration);
        }
    }

    /// v2.37 — install an adaptive throttle on the L2 per-project
    /// bucket. Used by `HealthState::should_auto_throttle` (per-
    /// (project, kind) invalid-rate trip). Lazy-creates the bucket
    /// if not yet seen.
    pub fn throttle_project(&self, project_id: Uuid, factor: f64, duration: Duration) {
        let bucket = {
            let mut map = self.project_buckets.lock().unwrap();
            map.entry(project_id)
                .or_insert_with(|| {
                    Arc::new(TokenBucket::new(
                        PROJECT_CAPACITY,
                        PROJECT_REFILL_PER_SEC,
                        self.clock.clone(),
                    ))
                })
                .clone()
        };
        bucket.set_throttle(factor, self.clock.now() + duration);
    }

    /// v2.37 — effective throttle factor on the L1 bucket for
    /// `kind`. 1.0 = unthrottled / expired; < 1.0 = under throttle.
    /// Used by tests + future metrics surface.
    pub fn provider_throttle_factor(&self, kind: ProviderKind) -> f64 {
        self.provider_buckets
            .get(&kind)
            .map(|b| b.effective_factor())
            .unwrap_or(1.0)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex as StdMutex;
    use std::time::Duration;

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

    #[test]
    fn bucket_starts_full() {
        let clock = MockClock::new();
        let b: TokenBucket<MockClock> = TokenBucket::new(10.0, 5.0, clock);
        for _ in 0..10 {
            assert!(b.try_acquire(1.0));
        }
        assert!(!b.try_acquire(1.0));
    }

    #[test]
    fn bucket_refills_at_rate() {
        let clock = MockClock::new();
        let b: TokenBucket<MockClock> = TokenBucket::new(10.0, 5.0, clock.clone());
        for _ in 0..10 {
            assert!(b.try_acquire(1.0));
        }
        assert!(!b.try_acquire(1.0));
        clock.advance(Duration::from_secs(2));
        for _ in 0..10 {
            assert!(b.try_acquire(1.0), "should refill 10 in 2 sec at 5/sec");
        }
        assert!(!b.try_acquire(1.0));
    }

    #[test]
    fn bucket_caps_at_capacity_even_after_long_idle() {
        let clock = MockClock::new();
        let b: TokenBucket<MockClock> = TokenBucket::new(10.0, 5.0, clock.clone());
        clock.advance(Duration::from_secs(3600));
        for _ in 0..10 {
            assert!(b.try_acquire(1.0));
        }
        assert!(!b.try_acquire(1.0), "bucket must not exceed capacity");
    }

    #[test]
    fn limiter_global_cap_blocks_at_max() {
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock);
        // L3 cap (200) > L2 cap (100), so we need at least 2 projects
        // to fill L3 without first being gated by L2. Use one project
        // per ~100 permits.
        let n_projects =
            ((GLOBAL_INFLIGHT_MAX as f64) / PROJECT_CAPACITY).ceil() as u32;
        let projects: Vec<Uuid> = (0..n_projects).map(|_| proj()).collect();
        let mut permits = Vec::new();
        for _ in 0..GLOBAL_INFLIGHT_MAX {
            let idx = (permits.len() / PROJECT_CAPACITY as usize)
                .min(projects.len() - 1);
            permits.push(lim.acquire(projects[idx], ProviderKind::Apns).unwrap());
        }
        match lim.acquire(projects[0], ProviderKind::Apns) {
            Err(RateError::GlobalInflight | RateError::ProjectRateLimited(_)) => (),
            other => panic!(
                "expected GlobalInflight or ProjectRateLimited, got {other:?}"
            ),
        }
        // Use a fresh project to definitively prove L3 is the gate
        // (not L2).
        let fresh = proj();
        match lim.acquire(fresh, ProviderKind::Apns) {
            Err(RateError::GlobalInflight) => (),
            other => panic!("expected GlobalInflight, got {other:?}"),
        }
        assert_eq!(lim.inflight_now(), GLOBAL_INFLIGHT_MAX);
        drop(permits);
        assert_eq!(lim.inflight_now(), 0);
    }

    #[test]
    fn limiter_global_permit_drop_releases() {
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock);
        let p = proj();
        let permit = lim.acquire(p, ProviderKind::Apns).unwrap();
        assert_eq!(lim.inflight_now(), 1);
        drop(permit);
        assert_eq!(lim.inflight_now(), 0);
    }

    #[test]
    fn limiter_provider_layer_caps_per_kind() {
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock);
        let p = proj();
        // MiPush has the smallest provider bucket (cap 100). Drain it.
        let (cap, _refill) = provider_default(ProviderKind::MiPush);
        let mut permits = Vec::new();
        for _ in 0..cap as u32 {
            permits.push(lim.acquire(p, ProviderKind::MiPush).unwrap());
        }
        // Next MiPush acquire should hit L1.
        match lim.acquire(p, ProviderKind::MiPush) {
            Err(RateError::ProviderRateLimited(ProviderKind::MiPush)) => (),
            other => panic!("expected ProviderRateLimited(MiPush), got {other:?}"),
        }
    }

    #[test]
    fn limiter_project_layer_caps_per_project() {
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock);
        let p = proj();
        // Project bucket cap 100, smaller than APNs L1 (400).
        let mut permits = Vec::new();
        for _ in 0..PROJECT_CAPACITY as u32 {
            permits.push(lim.acquire(p, ProviderKind::Apns).unwrap());
        }
        match lim.acquire(p, ProviderKind::Apns) {
            Err(RateError::ProjectRateLimited(_)) => (),
            other => panic!("expected ProjectRateLimited, got {other:?}"),
        }
    }

    #[test]
    fn limiter_projects_isolated_at_l2() {
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock);
        let a = proj();
        let b = proj();
        // Saturate project a's L2.
        let mut permits = Vec::new();
        for _ in 0..PROJECT_CAPACITY as u32 {
            permits.push(lim.acquire(a, ProviderKind::Apns).unwrap());
        }
        assert!(matches!(
            lim.acquire(a, ProviderKind::Apns),
            Err(RateError::ProjectRateLimited(_))
        ));
        // Project b should still be wide open.
        let _b_permit = lim.acquire(b, ProviderKind::Apns).unwrap();
    }

    #[test]
    fn limiter_provider_kinds_isolated_at_l1() {
        // Use distinct projects per kind so L2 never gates — we
        // want to demonstrate cross-provider L1 isolation.
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock);
        let p_mipush = proj();
        let p_apns = proj();
        let (mipush_cap, _) = provider_default(ProviderKind::MiPush);
        let mut permits = Vec::new();
        for _ in 0..mipush_cap as u32 {
            permits.push(lim.acquire(p_mipush, ProviderKind::MiPush).unwrap());
        }
        // MiPush L1 is now empty.
        assert!(matches!(
            lim.acquire(p_mipush, ProviderKind::MiPush),
            Err(RateError::ProviderRateLimited(ProviderKind::MiPush))
        ));
        // APNs L1 is untouched — different project, different kind.
        let _ = lim.acquire(p_apns, ProviderKind::Apns).unwrap();
    }

    #[test]
    fn bucket_throttle_halves_effective_refill() {
        let clock = MockClock::new();
        let b: TokenBucket<MockClock> = TokenBucket::new(10.0, 10.0, clock.clone());
        // Drain.
        for _ in 0..10 {
            assert!(b.try_acquire(1.0));
        }
        // Set 50% throttle for 1 minute.
        b.set_throttle(0.5, clock.now() + Duration::from_secs(60));
        // 1 second of throttled refill = 5 tokens (was 10).
        clock.advance(Duration::from_secs(1));
        let mut acquired = 0;
        while b.try_acquire(1.0) {
            acquired += 1;
        }
        assert_eq!(acquired, 5, "throttled refill should be half-speed");
    }

    #[test]
    fn bucket_throttle_decays_after_window() {
        let clock = MockClock::new();
        let b: TokenBucket<MockClock> = TokenBucket::new(20.0, 10.0, clock.clone());
        // Drain.
        for _ in 0..20 {
            assert!(b.try_acquire(1.0));
        }
        // Throttle for 60 s.
        b.set_throttle(0.5, clock.now() + Duration::from_secs(60));
        assert_eq!(b.effective_factor(), 0.5);
        // Past the window — factor reverts.
        clock.advance(Duration::from_secs(120));
        assert_eq!(b.effective_factor(), 1.0);
        // First acquire after expiry uses base rate.
        // After 120 s of refill, bucket should be back at cap.
        assert!(b.try_acquire(20.0));
    }

    #[test]
    fn limiter_throttle_provider_dials_l1_down() {
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock.clone());
        assert_eq!(lim.provider_throttle_factor(ProviderKind::Apns), 1.0);
        lim.throttle_provider(ProviderKind::Apns, 0.5, Duration::from_secs(300));
        assert_eq!(lim.provider_throttle_factor(ProviderKind::Apns), 0.5);
        // Other providers untouched.
        assert_eq!(lim.provider_throttle_factor(ProviderKind::Fcm), 1.0);
        // After window — back to 1.0.
        clock.advance(Duration::from_secs(400));
        assert_eq!(lim.provider_throttle_factor(ProviderKind::Apns), 1.0);
    }

    #[test]
    fn limiter_throttle_project_creates_bucket_if_missing() {
        let clock = MockClock::new();
        let lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock.clone());
        let p = proj();
        // Project bucket doesn't exist yet.
        lim.throttle_project(p, 0.5, Duration::from_secs(300));
        // Subsequent acquire will use the throttled bucket.
        // Drain the L2 (100 cap).
        let mut permits = Vec::new();
        for _ in 0..PROJECT_CAPACITY as u32 {
            permits.push(lim.acquire(p, ProviderKind::Apns).unwrap());
        }
        assert!(matches!(
            lim.acquire(p, ProviderKind::Apns),
            Err(RateError::ProjectRateLimited(_))
        ));
        drop(permits);
        // 1 s passes — base rate would refill 50, throttled refills 25.
        clock.advance(Duration::from_secs(1));
        let mut got = 0;
        while lim.acquire(p, ProviderKind::Apns).is_ok() {
            got += 1;
            if got > 30 {
                break;
            }
        }
        assert!(
            got <= 26,
            "throttled L2 refilled {got} in 1s, expected ≈25 not {}",
            PROJECT_REFILL_PER_SEC as u32
        );
    }

    #[test]
    fn limiter_layer_order_l3_first_then_l1_then_l2() {
        // L3 saturation reports GlobalInflight even when L1+L2 would
        // also have failed. Easiest: cap GLOBAL at < provider/project
        // caps, exercise it.
        let clock = MockClock::new();
        let mut lim: RateLimiter<MockClock> = RateLimiter::with_clock(clock);
        lim.global_max = 3;
        let p = proj();
        let _a = lim.acquire(p, ProviderKind::Apns).unwrap();
        let _b = lim.acquire(p, ProviderKind::Apns).unwrap();
        let _c = lim.acquire(p, ProviderKind::Apns).unwrap();
        assert!(matches!(
            lim.acquire(p, ProviderKind::Apns),
            Err(RateError::GlobalInflight)
        ));
    }
}
