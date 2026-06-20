use anyhow::Context;
use redis::Client;
use redis::Script;
use redis::aio::ConnectionManager;
use std::sync::LazyLock;

/// Open a Valkey connection manager. The manager handles reconnects
/// transparently for the lifetime of the process.
pub async fn connect(url: &str) -> anyhow::Result<ConnectionManager> {
    let client = Client::open(url).context("opening valkey client")?;
    let conn = ConnectionManager::new(client)
        .await
        .context("connecting valkey")?;
    Ok(conn)
}

// ── v1.1 P1 — atomic compound writes via Lua ────────────────────────────
//
// The bare `INCR` + `EXPIRE` pattern is racy: if the server restarts
// or the connection drops between the two calls, the new key persists
// without a TTL and leaks forever. Same story for `ZADD` / `HSET`
// followed by `EXPIRE` in `live_presence::record_heartbeat`. Both
// patterns now run as Lua scripts via `EVALSHA` (cached after first
// `EVAL`) — one round-trip, atomic per the Redis script model.
//
// The Lua snippets stay tiny and side-effect-only so we don't take on
// per-call interpretation cost beyond the network round-trip.

/// Atomic `INCR(key, by)` + `EXPIRE(key, ttl_seconds)` only when the
/// key was just created. Returns the post-INCR count.
///
/// Skipping `EXPIRE` after the first increment is a perf optimisation
/// — re-setting a TTL on every tick costs nothing semantically but
/// burns network on busy counters.
pub static INCR_WITH_TTL: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r#"
        local v = redis.call('INCRBY', KEYS[1], ARGV[1])
        if tonumber(v) == tonumber(ARGV[1]) then
            redis.call('EXPIRE', KEYS[1], ARGV[2])
        end
        return v
        "#,
    )
});

/// Live-presence heartbeat: atomic `ZADD(zk, ts, member)` +
/// `HSET(hk, member, dims)` + matching `EXPIRE` on both keys.
///
/// KEYS[1] = zset key, KEYS[2] = hash key.
/// ARGV[1] = ts_ms, ARGV[2] = member, ARGV[3] = dims, ARGV[4] = ttl.
pub static PRESENCE_HEARTBEAT: LazyLock<Script> = LazyLock::new(|| {
    Script::new(
        r#"
        redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
        redis.call('EXPIRE', KEYS[1], ARGV[4])
        redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
        redis.call('EXPIRE', KEYS[2], ARGV[4])
        return 1
        "#,
    )
});

/// Convenience: run `INCR_WITH_TTL` and return the post-INCR count.
pub async fn incr_with_ttl(
    conn: &mut ConnectionManager,
    key: &str,
    by: i64,
    ttl_secs: i64,
) -> redis::RedisResult<i64> {
    INCR_WITH_TTL
        .key(key)
        .arg(by)
        .arg(ttl_secs)
        .invoke_async(conn)
        .await
}
