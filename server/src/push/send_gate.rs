// v2.20 — Send API gate. Catches the three input-side failure modes
// that pre-v2.20 had no guard for:
//
//   1. Oversized payload. APNs and FCM both hard-cap notification
//      payloads at 4 KiB; sending bigger gets a guaranteed 4xx and
//      wastes a dispatch_cron tick. v2.20 rejects at API time with a
//      400 carrying actual + max byte counts.
//
//   2. Oversized batch. Expo-shape batches are documented at 100
//      messages/request; sending more is a recipe for partial-failure
//      ambiguity in Expo-compat responses. v2.20 hard-caps at 100,
//      same as upstream.
//
//   3. Per-token send rate. A single token receiving 60+ messages per
//      minute is almost certainly an integration bug (the host app
//      wired sentori.push.send into a tight loop). Without a guard
//      we'd happily flood APNs/FCM on the customer's behalf and
//      contribute to their sender-reputation score going sour.
//      v2.20 caps at 60 sends per rolling 60-second window per token
//      and surfaces 429 with `retry_after_secs` derived from the
//      oldest in-window send.
//
// All three are input-side guards (before enqueue). The dispatch-side
// L1/L2/L3 rate limiters described in the ironclad rules ship in v2.22.
//
// Test seam: the per-token rate state is built on the same `Clock`
// trait as `token_cache`, so unit tests can fast-forward without
// sleeping.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;

use super::token_cache::{Clock, RealClock};

/// APNs + FCM hard limit. Web Push (RFC 8030 §6) is also 4 KiB-class.
pub const PAYLOAD_MAX_BYTES: usize = 4 * 1024;

/// Expo's documented batch cap. Matches `sentori-native` chunking too.
pub const BATCH_MAX_RECIPIENTS: usize = 100;

/// Per-(token) cap in [`PER_TOKEN_RATE_WINDOW`]. Empirical: a single
/// token receiving > 1/sec sustained is almost always a host-app bug.
pub const PER_TOKEN_RATE_LIMIT: usize = 60;

/// Rolling window the rate counter spans.
pub const PER_TOKEN_RATE_WINDOW: Duration = Duration::from_secs(60);

/// What the API should surface to the caller. Each variant carries
/// the structured detail the HTTP layer needs to produce a meaningful
/// 400 / 429 response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateError {
    /// Single message serialized to more than [`PAYLOAD_MAX_BYTES`].
    /// HTTP 400.
    PayloadTooBig { actual: usize, max: usize },
    /// Single API call addressed more recipients than
    /// [`BATCH_MAX_RECIPIENTS`]. HTTP 400.
    BatchTooLarge { actual: usize, max: usize },
    /// One specific token exceeded its per-window cap. HTTP 429 with
    /// `retry_after_secs` ~= seconds until the oldest in-window send
    /// rolls off. Includes the token for logging; do NOT echo to the
    /// HTTP body verbatim — strip to a tail / hash before surfacing.
    TokenRateLimited {
        token: String,
        retry_after_secs: u32,
    },
}

impl GateError {
    /// Stable error code suitable for HTTP body `error.code`.
    pub fn code(&self) -> &'static str {
        match self {
            GateError::PayloadTooBig { .. } => "PayloadTooBig",
            GateError::BatchTooLarge { .. } => "BatchTooLarge",
            GateError::TokenRateLimited { .. } => "TokenRateLimited",
        }
    }
}

/// Process-wide gate. One instance lives on `AppState`; `Arc` shared
/// across handlers.
pub struct SendGate<C: Clock = RealClock> {
    rates: Mutex<HashMap<String, Vec<Instant>>>,
    clock: Arc<C>,
}

impl SendGate<RealClock> {
    pub fn new() -> Self {
        Self::with_clock(Arc::new(RealClock))
    }
}

impl Default for SendGate<RealClock> {
    fn default() -> Self {
        Self::new()
    }
}

/// Reject before enqueue if the serialized payload exceeds APNs's
/// 4 KiB cap. Standalone (does not touch the `SendGate` instance) so
/// callers don't need to disambiguate the generic clock parameter.
pub fn check_payload_size(payload_bytes: usize) -> Result<(), GateError> {
    if payload_bytes > PAYLOAD_MAX_BYTES {
        return Err(GateError::PayloadTooBig {
            actual: payload_bytes,
            max: PAYLOAD_MAX_BYTES,
        });
    }
    Ok(())
}

/// Reject before enqueue if a single API call addresses too many
/// recipients. Standalone (does not touch the `SendGate` instance)
/// so callers don't need to disambiguate the generic clock parameter.
pub fn check_batch_size(recipients: usize) -> Result<(), GateError> {
    if recipients > BATCH_MAX_RECIPIENTS {
        return Err(GateError::BatchTooLarge {
            actual: recipients,
            max: BATCH_MAX_RECIPIENTS,
        });
    }
    Ok(())
}

impl<C: Clock> SendGate<C> {
    pub fn with_clock(clock: Arc<C>) -> Self {
        Self {
            rates: Mutex::new(HashMap::new()),
            clock,
        }
    }

    /// Atomically check the per-token rate and, on success, record
    /// the send. Pruning of expired window entries happens inline.
    pub async fn check_and_record_token(&self, token: &str) -> Result<(), GateError> {
        let now = self.clock.now();
        let window_start = now
            .checked_sub(PER_TOKEN_RATE_WINDOW)
            .unwrap_or(now);
        let mut rates = self.rates.lock().await;
        let entries = rates.entry(token.to_string()).or_default();
        entries.retain(|t| *t >= window_start);
        if entries.len() >= PER_TOKEN_RATE_LIMIT {
            let oldest = entries[0];
            let until_rolloff = (oldest + PER_TOKEN_RATE_WINDOW)
                .saturating_duration_since(now)
                .as_secs()
                .max(1) as u32;
            return Err(GateError::TokenRateLimited {
                token: token.to_string(),
                retry_after_secs: until_rolloff,
            });
        }
        entries.push(now);
        Ok(())
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

    #[test]
    fn payload_under_cap_passes() {
        assert!(check_payload_size(4 * 1024).is_ok());
        assert!(check_payload_size(0).is_ok());
    }

    #[test]
    fn payload_over_cap_fails_with_actual_and_max() {
        let err = check_payload_size(4 * 1024 + 1).unwrap_err();
        match err {
            GateError::PayloadTooBig { actual, max } => {
                assert_eq!(actual, 4 * 1024 + 1);
                assert_eq!(max, 4 * 1024);
            }
            other => panic!("expected PayloadTooBig, got {other:?}"),
        }
    }

    #[test]
    fn batch_under_cap_passes() {
        assert!(check_batch_size(100).is_ok());
        assert!(check_batch_size(1).is_ok());
    }

    #[test]
    fn batch_over_cap_fails_with_actual_and_max() {
        let err = check_batch_size(101).unwrap_err();
        match err {
            GateError::BatchTooLarge { actual, max } => {
                assert_eq!(actual, 101);
                assert_eq!(max, 100);
            }
            other => panic!("expected BatchTooLarge, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn first_60_sends_pass_61st_fails() {
        let clock = MockClock::new();
        let gate: SendGate<MockClock> = SendGate::with_clock(clock.clone());
        for _ in 0..60 {
            gate.check_and_record_token("tok1").await.unwrap();
        }
        let err = gate.check_and_record_token("tok1").await.unwrap_err();
        assert_eq!(err.code(), "TokenRateLimited");
    }

    #[tokio::test]
    async fn rate_window_rolls_off_after_60s() {
        let clock = MockClock::new();
        let gate: SendGate<MockClock> = SendGate::with_clock(clock.clone());
        for _ in 0..60 {
            gate.check_and_record_token("tok1").await.unwrap();
        }
        assert!(gate.check_and_record_token("tok1").await.is_err());
        // Advance past the window — old entries should prune.
        clock.advance(Duration::from_secs(61));
        gate.check_and_record_token("tok1").await.unwrap();
    }

    #[tokio::test]
    async fn distinct_tokens_have_independent_quota() {
        let clock = MockClock::new();
        let gate: SendGate<MockClock> = SendGate::with_clock(clock.clone());
        for _ in 0..60 {
            gate.check_and_record_token("tokA").await.unwrap();
        }
        // tokA is full; tokB should still be wide open.
        for _ in 0..60 {
            gate.check_and_record_token("tokB").await.unwrap();
        }
        assert!(gate.check_and_record_token("tokA").await.is_err());
        assert!(gate.check_and_record_token("tokB").await.is_err());
    }

    #[tokio::test]
    async fn retry_after_secs_reflects_oldest_window_entry() {
        let clock = MockClock::new();
        let gate: SendGate<MockClock> = SendGate::with_clock(clock.clone());
        // Record one send at t=0, then move to t=10s and fill the rest.
        gate.check_and_record_token("tok").await.unwrap();
        clock.advance(Duration::from_secs(10));
        for _ in 0..59 {
            gate.check_and_record_token("tok").await.unwrap();
        }
        // Now full. The oldest entry is at t=0; window expires at t=60.
        // We're at t=10, so retry_after should be ~50.
        let err = gate.check_and_record_token("tok").await.unwrap_err();
        match err {
            GateError::TokenRateLimited {
                retry_after_secs, ..
            } => {
                assert!(
                    (48..=52).contains(&retry_after_secs),
                    "retry_after_secs={retry_after_secs} not near 50"
                );
            }
            other => panic!("expected TokenRateLimited, got {other:?}"),
        }
    }
}
