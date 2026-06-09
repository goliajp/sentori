// v2.21 — Per-(project, provider) quarantine.
//
// Provider-friendly ironclad rule #2 (docs/design/push-architecture.md):
// repeated 5xx / connection errors against APNs/FCM/HCM trip
// provider-side abuse heuristics. Naively retrying every transient
// failure (even with the v2.20 jitter ladder) keeps slamming a
// provider that's already misbehaving and contributes to the kind of
// sender-reputation drop that gets you de-prioritised — or for
// APNs's `TooManyProviderTokenUpdates` cousin, outright blacklisted.
//
// Mitigation: count consecutive transient failures per
// `(project_id, ProviderKind)`. After
// [`QUARANTINE_STREAK_THRESHOLD`] in a row, mark that target as
// quarantined for [`QUARANTINE_DURATION`]. Sends to a quarantined
// target during the window are deferred — they do **not** consume
// retry budget and do **not** call `provider.send()` (which would
// just feed the streak again).
//
// Multi-tenant fairness ironclad rule #3 (same doc): quarantine is
// scoped per `(project_id, ProviderKind)`. Project A's bad APNs
// cred does not freeze project B's APNs, nor project A's FCM. Tests
// enforce.
//
// Per-process only — horizontal-share is v2.38's job (queue
// upgrade). At v2.21's single-instance lx64 deployment this is
// enough.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use uuid::Uuid;

use super::providers::ProviderKind;
use super::token_cache::{Clock, RealClock};

/// After this many consecutive transient failures (5xx / connect
/// error / timeout / generic transport), the `(project, kind)` goes
/// into quarantine. 5 is conservative — APNs's
/// `TooManyProviderTokenUpdates` triggers around 4 token-mints/20-min,
/// so 5 streak failures is past any well-behaved client's
/// distribution.
pub const QUARANTINE_STREAK_THRESHOLD: u32 = 5;

/// Quarantine window. Sends to a quarantined target are deferred by
/// the remaining seconds in this window. 60 s lets a provider
/// breathe through a transient outage without us digging the hole
/// deeper.
pub const QUARANTINE_DURATION: Duration = Duration::from_secs(60);

#[derive(Default)]
struct State {
    /// `(project_id, kind) → consecutive transient-failure count`.
    /// Resets on the first non-transient outcome.
    streak: HashMap<(Uuid, ProviderKind), u32>,
    /// `(project_id, kind) → quarantine ends at Instant`. Until the
    /// `Instant` passes, dispatch_cron skips real sends to that
    /// target.
    until: HashMap<(Uuid, ProviderKind), Instant>,
}

/// Process-wide quarantine state. One instance lives on `Providers`;
/// `Arc` shared with dispatch_cron and any future admin / dashboard
/// surface.
pub struct QuarantineState<C: Clock = RealClock> {
    inner: Mutex<State>,
    clock: Arc<C>,
}

impl QuarantineState<RealClock> {
    /// Backed by the real wall clock.
    pub fn new() -> Self {
        Self::with_clock(Arc::new(RealClock))
    }
}

impl Default for QuarantineState<RealClock> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: Clock> QuarantineState<C> {
    pub fn with_clock(clock: Arc<C>) -> Self {
        Self {
            inner: Mutex::new(State::default()),
            clock,
        }
    }

    /// Returns `Some(remaining_secs)` if `(project_id, kind)` is
    /// currently quarantined; `None` if dispatch may proceed.
    pub async fn quarantined(&self, project_id: Uuid, kind: ProviderKind) -> Option<u32> {
        let now = self.clock.now();
        let inner = self.inner.lock().await;
        inner.until.get(&(project_id, kind)).and_then(|t| {
            if *t > now {
                let secs = t.saturating_duration_since(now).as_secs();
                Some(secs.max(1) as u32)
            } else {
                None
            }
        })
    }

    /// Call after a send whose outcome indicates the provider is
    /// healthy (Sent) or the failure is the client's fault, not the
    /// provider's (PermanentlyInvalidToken, EnvironmentMismatch,
    /// TerminalOther). Resets the streak count.
    pub async fn note_success_or_permanent(&self, project_id: Uuid, kind: ProviderKind) {
        let mut inner = self.inner.lock().await;
        inner.streak.remove(&(project_id, kind));
    }

    /// Call after a transient failure (HTTP 5xx, connection error,
    /// timeout, provider-error branch in dispatch). Returns `true`
    /// if this call tripped quarantine for the first time — caller
    /// may emit a tracing event.
    pub async fn note_transient_failure(&self, project_id: Uuid, kind: ProviderKind) -> bool {
        let now = self.clock.now();
        let mut inner = self.inner.lock().await;
        let key = (project_id, kind);
        let count = inner.streak.entry(key).or_insert(0);
        *count += 1;
        if *count >= QUARANTINE_STREAK_THRESHOLD {
            inner.until.insert(key, now + QUARANTINE_DURATION);
            inner.streak.remove(&key);
            true
        } else {
            false
        }
    }

    /// Test-/admin-only: force a target into quarantine for `duration`.
    /// Public so future admin endpoints (v2.23+) can use it.
    pub async fn quarantine_now(
        &self,
        project_id: Uuid,
        kind: ProviderKind,
        duration: Duration,
    ) {
        let now = self.clock.now();
        let mut inner = self.inner.lock().await;
        inner.until.insert((project_id, kind), now + duration);
    }

    /// Test-/admin-only: clear a target's quarantine + streak.
    pub async fn release(&self, project_id: Uuid, kind: ProviderKind) {
        let mut inner = self.inner.lock().await;
        let key = (project_id, kind);
        inner.until.remove(&key);
        inner.streak.remove(&key);
    }

    /// Current streak count for `(project, kind)`. Useful for
    /// dashboards + tests. Zero if no entry.
    pub async fn streak(&self, project_id: Uuid, kind: ProviderKind) -> u32 {
        let inner = self.inner.lock().await;
        inner
            .streak
            .get(&(project_id, kind))
            .copied()
            .unwrap_or(0)
    }
}

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
    async fn fresh_target_is_not_quarantined() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock);
        assert_eq!(q.quarantined(proj(), ProviderKind::Apns).await, None);
        assert_eq!(q.streak(proj(), ProviderKind::Apns).await, 0);
    }

    #[tokio::test]
    async fn streak_threshold_trips_quarantine() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock);
        let p = proj();
        for i in 0..QUARANTINE_STREAK_THRESHOLD - 1 {
            assert!(!q.note_transient_failure(p, ProviderKind::Apns).await);
            assert_eq!(q.streak(p, ProviderKind::Apns).await, i + 1);
            assert_eq!(q.quarantined(p, ProviderKind::Apns).await, None);
        }
        // The trip:
        assert!(q.note_transient_failure(p, ProviderKind::Apns).await);
        assert!(q.quarantined(p, ProviderKind::Apns).await.is_some());
        assert_eq!(
            q.streak(p, ProviderKind::Apns).await,
            0,
            "streak should reset when quarantine trips"
        );
    }

    #[tokio::test]
    async fn quarantine_lifts_after_duration() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock.clone());
        let p = proj();
        for _ in 0..QUARANTINE_STREAK_THRESHOLD {
            q.note_transient_failure(p, ProviderKind::Apns).await;
        }
        assert!(q.quarantined(p, ProviderKind::Apns).await.is_some());

        // Advance past the window.
        clock.advance(QUARANTINE_DURATION + Duration::from_secs(1));
        assert_eq!(q.quarantined(p, ProviderKind::Apns).await, None);
    }

    #[tokio::test]
    async fn success_resets_streak() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock);
        let p = proj();
        q.note_transient_failure(p, ProviderKind::Apns).await;
        q.note_transient_failure(p, ProviderKind::Apns).await;
        assert_eq!(q.streak(p, ProviderKind::Apns).await, 2);
        q.note_success_or_permanent(p, ProviderKind::Apns).await;
        assert_eq!(q.streak(p, ProviderKind::Apns).await, 0);
        // The next failure starts over.
        q.note_transient_failure(p, ProviderKind::Apns).await;
        assert_eq!(q.streak(p, ProviderKind::Apns).await, 1);
    }

    #[tokio::test]
    async fn distinct_projects_isolated() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock);
        let a = proj();
        let b = proj();
        for _ in 0..QUARANTINE_STREAK_THRESHOLD {
            q.note_transient_failure(a, ProviderKind::Apns).await;
        }
        assert!(q.quarantined(a, ProviderKind::Apns).await.is_some());
        assert_eq!(
            q.quarantined(b, ProviderKind::Apns).await,
            None,
            "project B's APNs must stay open while project A's is quarantined"
        );
    }

    #[tokio::test]
    async fn distinct_providers_isolated() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock);
        let p = proj();
        for _ in 0..QUARANTINE_STREAK_THRESHOLD {
            q.note_transient_failure(p, ProviderKind::Apns).await;
        }
        assert!(q.quarantined(p, ProviderKind::Apns).await.is_some());
        assert_eq!(
            q.quarantined(p, ProviderKind::Fcm).await,
            None,
            "project's FCM must stay open while its APNs is quarantined"
        );
    }

    #[tokio::test]
    async fn quarantine_now_then_release() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock);
        let p = proj();
        q.quarantine_now(p, ProviderKind::Hcm, Duration::from_secs(120))
            .await;
        let remaining = q.quarantined(p, ProviderKind::Hcm).await.unwrap();
        assert!(remaining >= 119 && remaining <= 120);

        q.release(p, ProviderKind::Hcm).await;
        assert_eq!(q.quarantined(p, ProviderKind::Hcm).await, None);
    }

    #[tokio::test]
    async fn remaining_secs_decreases_with_time() {
        let clock = MockClock::new();
        let q: QuarantineState<MockClock> = QuarantineState::with_clock(clock.clone());
        let p = proj();
        q.quarantine_now(p, ProviderKind::WebPush, Duration::from_secs(100))
            .await;
        let r1 = q.quarantined(p, ProviderKind::WebPush).await.unwrap();
        clock.advance(Duration::from_secs(30));
        let r2 = q.quarantined(p, ProviderKind::WebPush).await.unwrap();
        assert!(r2 < r1);
        assert!((68..=72).contains(&r2));
    }
}
