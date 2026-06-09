// v2.20 — Smart retry decisions for push dispatch.
//
// Why it exists. Pre-v2.20 dispatch_cron retried every Transient
// outcome on a fixed `[60s, 5m, 30m, 2h, 12h, 24h]` ladder with no
// awareness of error class. A 410 PermanentlyInvalidToken still
// hit `Transient`'s ladder once via the streak counter; provider
// `Retry-After` hints were respected but without jitter; and a
// thousand sends retrying off the same wall-clock tick produced a
// thundering-herd spike at every ladder boundary.
//
// v2.20 splits the decision into one function whose inputs are the
// already-classified outcome, the just-finished attempt index, and an
// optional provider hint. Output is `RetryDecision::DropPermanently`
// or `RetryDecision::Retry { after_secs }`. The retry delay carries
// ±20 % jitter so simultaneous failures fan out across the next
// retry window instead of bunching at one tick.
//
// The existing ladder is preserved as the fallback for
// `Transient { retry_after_secs: None }`. Customers see identical
// retry cadence unless the provider supplies a `Retry-After` — in
// which case Sentori now honours it.

use rand::Rng;

use super::providers::SendOutcome;

/// Fixed retry ladder used when the provider supplies no
/// `Retry-After` hint. Indices map 1:1 to `attempt - 1`.
///
/// Same shape as pre-v2.20 and `webhook_dispatch::RETRY_SCHEDULE_SECS`.
pub const RETRY_SCHEDULE_SECS: [i32; 6] = [60, 300, 1800, 7200, 43200, 86400];

/// Maximum total attempts. Once `attempt >= MAX_ATTEMPTS` the send is
/// permanently dropped regardless of outcome class.
pub const MAX_ATTEMPTS: i32 = 6;

/// Jitter fraction applied symmetrically around the base delay.
/// 0.20 → final delay falls in `[base * 0.80, base * 1.20]`.
const JITTER_FRACTION: f64 = 0.20;

/// What dispatch_cron should do after a single send attempt
/// completes. The caller already turned a provider response into a
/// [`SendOutcome`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RetryDecision {
    /// Drop the send permanently — failed status, no further retries.
    /// Either the outcome is unrecoverable (e.g. invalid token) or
    /// the retry budget is exhausted.
    DropPermanently,
    /// Re-queue the send for `after_secs` seconds from now.
    Retry { after_secs: i32 },
}

/// Decide what to do with a send whose `attempt`-th try just returned
/// `outcome`. `hint_retry_after_secs` is the provider-supplied
/// `Retry-After` header (or APNs/FCM equivalent), if any.
///
/// `attempt` is 1-based — `1` means "we just tried once".
pub fn decide_retry(
    outcome: &SendOutcome,
    attempt: i32,
    hint_retry_after_secs: Option<i32>,
) -> RetryDecision {
    match outcome {
        SendOutcome::Sent => RetryDecision::DropPermanently, // caller marks sent, never asks
        SendOutcome::PermanentlyInvalidToken => RetryDecision::DropPermanently,
        SendOutcome::EnvironmentMismatch => RetryDecision::DropPermanently,
        SendOutcome::TerminalOther { .. } => RetryDecision::DropPermanently,
        SendOutcome::Transient { .. } => {
            if attempt >= MAX_ATTEMPTS {
                return RetryDecision::DropPermanently;
            }
            let idx = ((attempt - 1) as usize).min(RETRY_SCHEDULE_SECS.len() - 1);
            let base = hint_retry_after_secs
                .unwrap_or(RETRY_SCHEDULE_SECS[idx])
                .max(1);
            RetryDecision::Retry {
                after_secs: apply_jitter(base, &mut rand::thread_rng()),
            }
        }
    }
}

/// Apply ±[`JITTER_FRACTION`] jitter to `base`. Pulled out so tests
/// can pass a seeded RNG and assert deterministic output.
fn apply_jitter<R: Rng>(base: i32, rng: &mut R) -> i32 {
    let span = ((base as f64) * JITTER_FRACTION).round() as i32;
    if span <= 0 {
        return base.max(1);
    }
    let offset = rng.gen_range(-span..=span);
    (base + offset).max(1)
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    use super::super::providers::SendOutcome;
    use super::*;

    #[test]
    fn permanently_invalid_token_drops() {
        let d = decide_retry(&SendOutcome::PermanentlyInvalidToken, 1, None);
        assert_eq!(d, RetryDecision::DropPermanently);
    }

    #[test]
    fn environment_mismatch_drops() {
        let d = decide_retry(&SendOutcome::EnvironmentMismatch, 1, None);
        assert_eq!(d, RetryDecision::DropPermanently);
    }

    #[test]
    fn terminal_other_drops() {
        let d = decide_retry(
            &SendOutcome::TerminalOther {
                reason: "MessageTooBig".into(),
            },
            1,
            None,
        );
        assert_eq!(d, RetryDecision::DropPermanently);
    }

    #[test]
    fn transient_uses_ladder_when_no_hint() {
        // attempt=1 → 60s ± 20% (i.e. 48..=72)
        let d = decide_retry(
            &SendOutcome::Transient {
                retry_after_secs: None,
            },
            1,
            None,
        );
        match d {
            RetryDecision::Retry { after_secs } => {
                assert!(
                    (48..=72).contains(&after_secs),
                    "delay {after_secs} not in 60s ±20% range"
                );
            }
            other => panic!("expected Retry, got {other:?}"),
        }
    }

    #[test]
    fn transient_respects_provider_hint_over_ladder() {
        // attempt=2 would normally be 300s; hint says 30s.
        let d = decide_retry(
            &SendOutcome::Transient {
                retry_after_secs: Some(30),
            },
            2,
            Some(30),
        );
        match d {
            RetryDecision::Retry { after_secs } => {
                assert!(
                    (24..=36).contains(&after_secs),
                    "delay {after_secs} not in 30s ±20% range"
                );
            }
            other => panic!("expected Retry, got {other:?}"),
        }
    }

    #[test]
    fn transient_drops_after_max_attempts() {
        let d = decide_retry(
            &SendOutcome::Transient {
                retry_after_secs: None,
            },
            MAX_ATTEMPTS,
            None,
        );
        assert_eq!(d, RetryDecision::DropPermanently);
    }

    #[test]
    fn transient_at_attempt_5_uses_index_4() {
        // attempt=5 → ladder[4] = 43200s ± 20%
        let d = decide_retry(
            &SendOutcome::Transient {
                retry_after_secs: None,
            },
            5,
            None,
        );
        match d {
            RetryDecision::Retry { after_secs } => {
                let base = RETRY_SCHEDULE_SECS[4];
                let span = (base as f64 * JITTER_FRACTION) as i32;
                assert!(
                    (base - span..=base + span).contains(&after_secs),
                    "delay {after_secs} not in {base}s ±20% range"
                );
            }
            other => panic!("expected Retry, got {other:?}"),
        }
    }

    #[test]
    fn jitter_with_seeded_rng_is_deterministic() {
        let mut rng = StdRng::seed_from_u64(42);
        let a = apply_jitter(1000, &mut rng);
        let mut rng = StdRng::seed_from_u64(42);
        let b = apply_jitter(1000, &mut rng);
        assert_eq!(a, b);
        assert!((800..=1200).contains(&a));
    }

    #[test]
    fn jitter_never_returns_zero_or_negative() {
        let mut rng = StdRng::seed_from_u64(1);
        for _ in 0..1000 {
            let v = apply_jitter(1, &mut rng);
            assert!(v >= 1, "jitter produced {v}, must be >= 1");
        }
    }
}
