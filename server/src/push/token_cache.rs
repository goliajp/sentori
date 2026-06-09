// v2.20 — Unified token cache for every JWT / OAuth-token signer in the
// push pipeline. Backs APNs JWT (`(team_id, key_id) → JWT`),
// FCM v1 OAuth (`service_account_email → access_token`), HCM OAuth
// (`app_id → access_token`), and VAPID Web Push JWT
// (`(vapid_public, origin) → JWT`).
//
// Why it exists. Provider-friendly ironclad rule #2 (see
// docs/design/push-architecture.md): re-signing JWT or re-OAuthing per
// send is a P0 defect because APNs throttles `TooManyProviderTokenUpdates`
// (HTTP 22001) and FCM has its own quota for token refreshes. The
// v1.1.4 incident bit on exactly this — every queued push_sends row
// signed a new JWT, blowing past APNs's per-Team-Key token-update
// budget. Each provider previously kept its own ad-hoc cache (or
// none, in APNs's case). One abstraction = one place to enforce TTL
// math + invalidation on credential rotation + a `Clock` seam for tests
// that would have caught the v1.1.2 `rust_crypto` panic too.
//
// Per-instance only — horizontal-share via Valkey is v2.38's job
// (queue upgrade). For single-instance lx64 self-host this is enough.
//
// Concurrency note. `get_or_insert_with` does NOT singleflight
// duplicate refreshes on cache miss — two concurrent requests for the
// same expired key will both call `refresh`. Acceptable because (a) the
// extra OAuth round-trip is harmless and (b) once both complete, the
// last one wins and subsequent reads share it. Adding singleflight would
// require holding the lock across `refresh().await`, which serializes
// distinct keys too. Trade-off is intentional.

use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

/// Time source for cache expiry. Production uses [`RealClock`]; tests
/// inject a controllable mock so they don't depend on wall time.
pub trait Clock: Send + Sync + 'static {
    fn now(&self) -> Instant;
}

/// Wall-clock implementation — `Instant::now()`.
pub struct RealClock;

impl Clock for RealClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

struct Entry<V> {
    value: V,
    expires_at: Instant,
}

/// Process-wide, generic token cache.
///
/// `K` is the cache key (e.g. `(team_id, key_id)` for APNs JWT,
/// `service_account_email` for FCM v1 OAuth).
///
/// `V` is the cached secret/token (always `String` in current providers,
/// but generic in case a future provider needs a richer type).
///
/// `C` is the clock — defaults to [`RealClock`] in production.
pub struct TokenCache<K, V, C = RealClock>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + 'static,
    C: Clock,
{
    inner: Arc<Mutex<HashMap<K, Entry<V>>>>,
    clock: Arc<C>,
}

impl<K, V> TokenCache<K, V, RealClock>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + 'static,
{
    /// New cache backed by the real wall clock.
    pub fn new() -> Self {
        Self::with_clock(Arc::new(RealClock))
    }
}

impl<K, V> Default for TokenCache<K, V, RealClock>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + 'static,
{
    fn default() -> Self {
        Self::new()
    }
}

impl<K, V, C> TokenCache<K, V, C>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + 'static,
    C: Clock,
{
    /// New cache backed by the given clock. Tests pass a `MockClock`
    /// here; production paths use [`TokenCache::new`] which selects
    /// [`RealClock`].
    pub fn with_clock(clock: Arc<C>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            clock,
        }
    }

    /// Return a still-valid cached `V` for `key`, or call `refresh` to
    /// build a new one. `refresh` returns `(value, expires_at)` so the
    /// caller picks the TTL (different providers have different
    /// per-token validity windows). On cache miss + successful refresh
    /// the entry is inserted before returning.
    ///
    /// `refresh` runs OUTSIDE the lock — concurrent refreshes for
    /// different keys do not serialize.
    pub async fn get_or_insert_with<F, Fut, E>(&self, key: K, refresh: F) -> Result<V, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<(V, Instant), E>>,
    {
        let now = self.clock.now();
        {
            let cache = self.inner.lock().await;
            if let Some(e) = cache.get(&key) {
                if e.expires_at > now {
                    return Ok(e.value.clone());
                }
            }
        }
        let (value, expires_at) = refresh().await?;
        let mut cache = self.inner.lock().await;
        cache.insert(
            key,
            Entry {
                value: value.clone(),
                expires_at,
            },
        );
        Ok(value)
    }

    /// Drop the entry for `key` if any. Call this on credential
    /// rotation (e.g. APNs Team/Key swap) so the next send re-signs
    /// against the new secret.
    pub async fn invalidate(&self, key: &K) {
        self.inner.lock().await.remove(key);
    }

    /// Drop every entry whose `expires_at <= now`. Cheap maintenance
    /// hook for cases where the cache might accumulate cold keys
    /// (e.g. retired credential rows). Not currently called on a
    /// schedule — providers call `invalidate` explicitly.
    pub async fn evict_expired(&self) {
        let now = self.clock.now();
        self.inner.lock().await.retain(|_, e| e.expires_at > now);
    }

    /// Number of entries currently held. Useful for tests + future
    /// metrics export. Note: includes expired-but-not-yet-evicted rows.
    pub async fn len(&self) -> usize {
        self.inner.lock().await.len()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};
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

    #[tokio::test]
    async fn hit_returns_cached_value_without_invoking_refresh() {
        let clock = MockClock::new();
        let cache: TokenCache<&str, String, MockClock> = TokenCache::with_clock(clock.clone());
        let calls = AtomicU32::new(0);

        let v1 = cache
            .get_or_insert_with("k", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>(("first".to_string(), clock.now() + Duration::from_secs(60)))
            })
            .await
            .unwrap();
        assert_eq!(v1, "first");
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        // Advance time but stay under TTL.
        clock.advance(Duration::from_secs(30));

        let v2 = cache
            .get_or_insert_with("k", || async {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok::<_, ()>(("second".to_string(), clock.now() + Duration::from_secs(60)))
            })
            .await
            .unwrap();
        assert_eq!(v2, "first", "second call should hit cache, not refresh");
        assert_eq!(calls.load(Ordering::SeqCst), 1, "refresh ran twice");
    }

    #[tokio::test]
    async fn expiry_triggers_refresh() {
        let clock = MockClock::new();
        let cache: TokenCache<&str, String, MockClock> = TokenCache::with_clock(clock.clone());

        cache
            .get_or_insert_with("k", || async {
                Ok::<_, ()>(("first".to_string(), clock.now() + Duration::from_secs(60)))
            })
            .await
            .unwrap();

        clock.advance(Duration::from_secs(61));

        let v2 = cache
            .get_or_insert_with("k", || async {
                Ok::<_, ()>(("second".to_string(), clock.now() + Duration::from_secs(60)))
            })
            .await
            .unwrap();
        assert_eq!(v2, "second");
    }

    #[tokio::test]
    async fn invalidate_drops_entry() {
        let clock = MockClock::new();
        let cache: TokenCache<&str, String, MockClock> = TokenCache::with_clock(clock.clone());

        cache
            .get_or_insert_with("k", || async {
                Ok::<_, ()>(("first".to_string(), clock.now() + Duration::from_secs(3600)))
            })
            .await
            .unwrap();
        assert_eq!(cache.len().await, 1);

        cache.invalidate(&"k").await;
        assert_eq!(cache.len().await, 0);

        let v2 = cache
            .get_or_insert_with("k", || async {
                Ok::<_, ()>(("second".to_string(), clock.now() + Duration::from_secs(3600)))
            })
            .await
            .unwrap();
        assert_eq!(v2, "second");
    }

    #[tokio::test]
    async fn evict_expired_drops_only_stale_entries() {
        let clock = MockClock::new();
        let cache: TokenCache<&str, String, MockClock> = TokenCache::with_clock(clock.clone());

        cache
            .get_or_insert_with("short", || async {
                Ok::<_, ()>(("a".to_string(), clock.now() + Duration::from_secs(10)))
            })
            .await
            .unwrap();
        cache
            .get_or_insert_with("long", || async {
                Ok::<_, ()>(("b".to_string(), clock.now() + Duration::from_secs(3600)))
            })
            .await
            .unwrap();
        assert_eq!(cache.len().await, 2);

        clock.advance(Duration::from_secs(11));
        cache.evict_expired().await;
        assert_eq!(cache.len().await, 1, "short should be gone, long should stay");
    }

    #[tokio::test]
    async fn refresh_error_does_not_insert() {
        let clock = MockClock::new();
        let cache: TokenCache<&str, String, MockClock> = TokenCache::with_clock(clock.clone());

        let result: Result<String, &'static str> = cache
            .get_or_insert_with("k", || async { Err("boom") })
            .await;
        assert_eq!(result, Err("boom"));
        assert_eq!(cache.len().await, 0);
    }

    #[tokio::test]
    async fn distinct_keys_cached_independently() {
        let clock = MockClock::new();
        let cache: TokenCache<&str, String, MockClock> = TokenCache::with_clock(clock.clone());

        cache
            .get_or_insert_with("a", || async {
                Ok::<_, ()>(("A".to_string(), clock.now() + Duration::from_secs(60)))
            })
            .await
            .unwrap();
        cache
            .get_or_insert_with("b", || async {
                Ok::<_, ()>(("B".to_string(), clock.now() + Duration::from_secs(60)))
            })
            .await
            .unwrap();
        assert_eq!(cache.len().await, 2);

        let va = cache
            .get_or_insert_with("a", || async {
                Ok::<_, ()>(("WRONG".to_string(), clock.now() + Duration::from_secs(60)))
            })
            .await
            .unwrap();
        assert_eq!(va, "A");
    }
}
