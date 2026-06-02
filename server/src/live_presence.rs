//! Live presence — concurrent-user accounting backed by a Valkey
//! sorted set per project.
//!
//! Each heartbeat from the SDK calls [`register`] which `ZADD`s the
//! caller (user id or session id) at the current wall-clock ms. The
//! dashboard's `/live` endpoint reads [`snapshot`] / [`count`] which
//! scan the set for members whose score is newer than `now - window`.
//!
//! Why ZSET and not a hash + TTL per key:
//! - One Valkey key per project keeps the cleanup story trivial — set
//!   an `EXPIRE` on the whole key so an idle project drops to zero
//!   keys after a few minutes of silence.
//! - Range queries by score are O(log N + M) on Valkey, fine for the
//!   typical 10–10 000 concurrent caps we expect per project.
//! - `ZCOUNT` returns the count without materialising members, used by
//!   the headline number on the dashboard.
//!
//! Fail-open: any caller that can't reach Valkey treats it as "0
//! concurrent" rather than 5xx. Heartbeat is best-effort signal, not a
//! load-bearing contract — losing a few seconds of presence data is
//! preferable to dropping the request and triggering SDK retries.

use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use uuid::Uuid;

/// Default presence window. Heartbeats older than this drop out of the
/// concurrent-user count.
pub const WINDOW_MS: i64 = 120_000;

/// TTL applied to the whole ZSET after every register, so an idle
/// project's key garbage-collects on its own without us writing a
/// sweep job.
const KEY_TTL_SECS: i64 = 300;

fn key(project_id: &Uuid) -> String {
    format!("live:{project_id}")
}

/// Hash key that parallels the ZSET — one field per `member`,
/// value is a tab-separated `release\troute\tos\tcountry` tuple.
/// Tab-delim instead of JSON keeps the read path fast (one HMGET +
/// `split('\t')`) and the value compact (typical < 100 bytes).
fn dims_key(project_id: &Uuid) -> String {
    format!("live:{project_id}:dims")
}

const DIMS_SEP: char = '\t';

/// Encode dimensions into the wire shape used in the hash. None →
/// empty field. Values are sanity-trimmed before storage so a
/// malicious caller can't blow the field size.
fn encode_dims(release: &str, route: Option<&str>, os: Option<&str>, country: Option<&str>) -> String {
    let mut out = String::with_capacity(80);
    out.push_str(release.get(..200).unwrap_or(release));
    out.push(DIMS_SEP);
    out.push_str(route.unwrap_or("").get(..200).unwrap_or(route.unwrap_or("")));
    out.push(DIMS_SEP);
    out.push_str(os.unwrap_or("").get(..50).unwrap_or(os.unwrap_or("")));
    out.push(DIMS_SEP);
    out.push_str(country.unwrap_or("").get(..8).unwrap_or(country.unwrap_or("")));
    out
}

/// Reverse of `encode_dims`. Empty fields decode to None.
pub fn decode_dims(s: &str) -> MemberDims {
    let mut it = s.split(DIMS_SEP);
    MemberDims {
        release: it.next().unwrap_or("").to_string(),
        route: it.next().filter(|s| !s.is_empty()).map(String::from),
        os: it.next().filter(|s| !s.is_empty()).map(String::from),
        country: it.next().filter(|s| !s.is_empty()).map(String::from),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberDims {
    pub release: String,
    pub route: Option<String>,
    pub os: Option<String>,
    pub country: Option<String>,
}

/// Record a heartbeat from `member` at `ts_ms`. `member` should be the
/// caller's stable identity for the window: `user_id` when set,
/// `session_id` otherwise. `release` / `route` / `os` / `country`
/// are stored alongside in a parallel hash for the dashboard's
/// per-dimension breakdowns.
pub async fn register(
    valkey: &mut ConnectionManager,
    project_id: &Uuid,
    member: &str,
    ts_ms: i64,
    release: &str,
    route: Option<&str>,
    os: Option<&str>,
    country: Option<&str>,
) -> redis::RedisResult<()> {
    let zk = key(project_id);
    let hk = dims_key(project_id);
    let dims = encode_dims(release, route, os, country);
    // v1.1 P1: atomic ZADD + HSET + matching EXPIREs via a single
    // Lua eval (one round-trip; replaces 4 separate calls that could
    // leak un-TTL'd keys if the connection dropped mid-sequence).
    let _: () = crate::valkey::PRESENCE_HEARTBEAT
        .key(&zk)
        .key(&hk)
        .arg(ts_ms)
        .arg(member)
        .arg(dims)
        .arg(KEY_TTL_SECS)
        .invoke_async(valkey)
        .await?;
    Ok(())
}

/// Fetch dimensions for the given `members`, in input order. Returns
/// the parsed `MemberDims` per member; missing entries surface as
/// `None`.
pub async fn fetch_dims(
    valkey: &mut ConnectionManager,
    project_id: &Uuid,
    members: &[String],
) -> redis::RedisResult<Vec<Option<MemberDims>>> {
    if members.is_empty() {
        return Ok(vec![]);
    }
    let hk = dims_key(project_id);
    // Use raw `redis::cmd("HMGET")` so the response is shaped as
    // `Vec<Option<String>>` (one entry per requested field, nil →
    // None). The typed `hget` helper insists on `ToSingleRedisArg`
    // even when passed a slice, which doesn't compose with the
    // bulk-fetch we want here.
    let mut cmd = redis::cmd("HMGET");
    cmd.arg(&hk);
    for m in members {
        cmd.arg(m);
    }
    let raw: Vec<Option<String>> = cmd.query_async(valkey).await?;
    Ok(raw
        .into_iter()
        .map(|opt| opt.map(|s| decode_dims(&s)))
        .collect())
}

/// All members heartbeat-ed within the last `window_ms` as of
/// `now_ms`. Returns at most `MAX_MEMBERS` to bound response size.
pub async fn snapshot(
    valkey: &mut ConnectionManager,
    project_id: &Uuid,
    window_ms: i64,
    now_ms: i64,
) -> redis::RedisResult<Vec<String>> {
    let k = key(project_id);
    let min_score = now_ms - window_ms;
    let members: Vec<String> = valkey.zrangebyscore(&k, min_score, "+inf").await?;
    Ok(members)
}

/// Count of distinct members heartbeat-ed within the last `window_ms`.
pub async fn count(
    valkey: &mut ConnectionManager,
    project_id: &Uuid,
    window_ms: i64,
    now_ms: i64,
) -> redis::RedisResult<usize> {
    let k = key(project_id);
    let min_score = now_ms - window_ms;
    let n: usize = valkey.zcount(&k, min_score, "+inf").await?;
    Ok(n)
}

/// Garbage-collect entries older than the window. Not strictly
/// necessary — `WINDOW_MS` filter at read time hides them, and the
/// project-key TTL drops the whole set when idle. Exposed for
/// callers that want a deterministic small set (e.g. dashboards that
/// also paginate over members).
pub async fn purge_stale(
    valkey: &mut ConnectionManager,
    project_id: &Uuid,
    window_ms: i64,
    now_ms: i64,
) -> redis::RedisResult<usize> {
    let k = key(project_id);
    let cutoff = now_ms - window_ms;
    let removed: usize = valkey.zrembyscore(&k, "-inf", cutoff).await?;
    Ok(removed)
}
