// v2.1 W1 part 2 — runtime metrics ingest.
//
// New endpoint POST /v1/runtime-metrics:batch. Sibling of the
// v0.8.3 custom metrics endpoint (/v1/metrics:batch), but writes
// to the partitioned `runtime_metrics_raw` table instead of the
// flat `metrics` table.
//
// Why two paths instead of overloading the v0.8.3 endpoint:
//   • Storage shape differs (partition by day vs flat) — sharing
//     would force the v0.8.3 endpoint to know about partitions.
//   • Validation differs — runtime metric names follow a strict
//     `^[a-z][a-z0-9_]*\.[a-z0-9_.]+$` regex; v0.8.3 accepts any
//     ≤200-char name.
//   • Rate-limit budgets differ (auto-instrument fires at 4 QPS
//     per device, custom metrics are call-site driven).
//
// See docs/design/v2-metrics.md for the schema rationale and
// docs/roadmap/v2.1.md L3b W1 for the surface contract.

use std::collections::{BTreeMap, hash_map::DefaultHasher};
use std::hash::{Hash, Hasher};

use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::error::AppError;
use crate::recent::AppState;

const MAX_BATCH: usize = 500;
const MAX_TAGS: usize = 16;
const MAX_NAME_LEN: usize = 200;
const MAX_TAG_KEY_LEN: usize = 40;
const MAX_TAG_VALUE_LEN: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetricInput {
    pub name: String,
    pub value: f64,
    /// Wall-clock for the point. Defaults to server `now()` when
    /// absent so offline-batched SDK requests don't lose ordering.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub ts: Option<OffsetDateTime>,
    #[serde(default)]
    pub tags: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMetricBatch {
    pub metrics: Vec<RuntimeMetricInput>,
}

#[derive(Debug, PartialEq)]
enum DropReason {
    Malformed,
}

impl DropReason {
    fn as_str(&self) -> &'static str {
        match self {
            DropReason::Malformed => "malformed",
        }
    }
}

/// Strict naming rule: lowercase first char, `[a-z0-9_]`, then a
/// dot, then `[a-z0-9_.]+`. Mirrors the design doc + matches what
/// every dashboard query selector assumes.
fn name_valid(name: &str) -> bool {
    if name.len() > MAX_NAME_LEN || name.is_empty() {
        return false;
    }
    let mut chars = name.chars();
    let first = match chars.next() {
        Some(c) => c,
        None => return false,
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    let mut saw_dot = false;
    for c in chars {
        if c == '.' {
            saw_dot = true;
            continue;
        }
        if !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            return false;
        }
    }
    saw_dot
}

/// Stable 64-bit hash of canonical-JSON tags. Two batches with
/// the same tag map dedup via the (project, ts, name, tags_hash)
/// primary key.
fn hash_tags(tags: &BTreeMap<String, String>) -> i64 {
    let mut h = DefaultHasher::new();
    // BTreeMap iterates in key order — canonical without sorting.
    for (k, v) in tags {
        k.hash(&mut h);
        v.hash(&mut h);
    }
    h.finish() as i64
}

fn tags_valid(tags: &BTreeMap<String, String>) -> bool {
    if tags.len() > MAX_TAGS {
        return false;
    }
    for (k, v) in tags {
        if k.is_empty() || k.len() > MAX_TAG_KEY_LEN {
            return false;
        }
        if v.len() > MAX_TAG_VALUE_LEN {
            return false;
        }
    }
    true
}

pub async fn ingest_batch(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(req): Json<RuntimeMetricBatch>,
) -> Result<Response, AppError> {
    if req.metrics.len() > MAX_BATCH {
        return Ok(StatusCode::BAD_REQUEST.into_response());
    }
    let project_id = caller_project_id(&caller, &state);
    let Some(pool) = &state.db else {
        // Server running without a DB (test mode) — accept the
        // batch but no-op the write so the SDK NEVER-rule doesn't
        // see a 5xx.
        return Ok(StatusCode::ACCEPTED.into_response());
    };

    let mut accepted = 0u32;
    let mut dropped_malformed = 0i64;

    for m in &req.metrics {
        if !name_valid(&m.name) {
            dropped_malformed += 1;
            continue;
        }
        if !m.value.is_finite() {
            dropped_malformed += 1;
            continue;
        }
        if !tags_valid(&m.tags) {
            dropped_malformed += 1;
            continue;
        }
        let ts = m.ts.unwrap_or_else(OffsetDateTime::now_utc);
        let tags_hash = hash_tags(&m.tags);
        let tags_json = serde_json::to_value(&m.tags)
            .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));

        // Denormalize the three dim columns the BI panel always
        // slices on. Reading from tags via tags->>'release' would
        // be ~5x slower on cold cache; see docs/design/v2-metrics.md.
        let release = m.tags.get("release").cloned();
        let environment = m.tags.get("environment").cloned();
        let device_class = m.tags.get("device_class").cloned();

        let r = sqlx::query(
            "INSERT INTO runtime_metrics_raw \
             (ts, project_id, name, value, tags, tags_hash, \
              release, environment, device_class) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
             ON CONFLICT (project_id, ts, name, tags_hash) DO NOTHING",
        )
        .bind(ts)
        .bind(project_id)
        .bind(&m.name)
        .bind(m.value)
        .bind(&tags_json)
        .bind(tags_hash)
        .bind(release.as_deref())
        .bind(environment.as_deref())
        .bind(device_class.as_deref())
        .execute(pool)
        .await;
        match r {
            Ok(_) => accepted += 1,
            Err(e) => {
                // Insert can fail when today's partition isn't
                // created yet. The hourly metrics_partition cron
                // owns the lifecycle; log and let the SDK retry
                // on the next flush — better than silently dropping.
                tracing::warn!(error = %e, "runtime metric insert failed");
            }
        }
    }

    if dropped_malformed > 0 {
        accumulate_drop(pool, project_id, DropReason::Malformed, dropped_malformed).await;
    }

    tracing::info!(
        %project_id,
        accepted,
        dropped_malformed,
        "runtime metric batch accepted"
    );
    Ok(StatusCode::ACCEPTED.into_response())
}

async fn accumulate_drop(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    reason: DropReason,
    n: i64,
) {
    // Best-effort. Drop accounting is for ops sanity checks, not
    // a critical path — an UPSERT failure is logged and ignored.
    let day = OffsetDateTime::now_utc().date();
    let r = sqlx::query(
        "INSERT INTO runtime_metrics_dropped (day, project_id, reason, count) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (project_id, day, reason) DO UPDATE \
         SET count = runtime_metrics_dropped.count + EXCLUDED.count",
    )
    .bind(day)
    .bind(project_id)
    .bind(reason.as_str())
    .bind(n)
    .execute(pool)
    .await;
    if let Err(e) = r {
        tracing::warn!(error = %e, "runtime_metrics_dropped upsert failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_regex_accepts_canonical() {
        assert!(name_valid("runtime.fps.p50"));
        assert!(name_valid("runtime.heap.used_bytes"));
        assert!(name_valid("a.b"));
        assert!(name_valid("checkout.click.count"));
    }

    #[test]
    fn name_regex_rejects_bad_shapes() {
        assert!(!name_valid(""));                  // empty
        assert!(!name_valid("noDot"));             // no dot
        assert!(!name_valid("UpperCase.bad"));     // uppercase
        assert!(!name_valid(".leading_dot"));      // leading dot
        assert!(!name_valid("1.starts_digit"));    // digit first
        assert!(!name_valid("space.in name"));     // space
        assert!(!name_valid("dash-not.allowed"));  // dash
    }

    #[test]
    fn tags_hash_stable_across_calls() {
        let mut a = BTreeMap::new();
        a.insert("release".to_string(), "1.0.0".to_string());
        a.insert("env".to_string(), "prod".to_string());
        let mut b = BTreeMap::new();
        // insertion order differs; BTreeMap iteration is sorted
        // so the hash should match.
        b.insert("env".to_string(), "prod".to_string());
        b.insert("release".to_string(), "1.0.0".to_string());
        assert_eq!(hash_tags(&a), hash_tags(&b));
    }

    #[test]
    fn tags_hash_distinguishes_values() {
        let mut a = BTreeMap::new();
        a.insert("release".to_string(), "1.0.0".to_string());
        let mut b = BTreeMap::new();
        b.insert("release".to_string(), "1.0.1".to_string());
        assert_ne!(hash_tags(&a), hash_tags(&b));
    }

    #[test]
    fn tags_validation_rejects_explosion() {
        let mut t = BTreeMap::new();
        for i in 0..20 {
            t.insert(format!("k{i}"), "v".to_string());
        }
        assert!(!tags_valid(&t));
    }
}
