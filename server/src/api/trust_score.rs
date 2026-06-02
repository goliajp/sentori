// v1.1 chunk S3 — trust scoring + Posture dashboard backing API.
//
// Score computation:
//   - Baseline 100, floored at 0, ceiling 100.
//   - Each `security_events` row in the last 24h subtracts a weight
//     keyed off the event's `kind`. Unknown kinds subtract 5 (small)
//     so an unrecognised signal still tugs the score, but not heavily.
//   - Computed on demand from the same security_events row stream
//     the Pin anomaly panel reads. A `trust_profiles` materialised
//     table lands in v1.2 once query volume + write-path ergonomics
//     justify the extra storage / cache layer.
//
// Endpoints:
//   `GET /v1/security/score?installId=<id>` (ingest token) —
//       SDK-facing. Returns `{ score, signals: [...], computedAt }`.
//   `GET /admin/api/projects/{id}/trust/scores?limit=...` —
//       admin / dashboard. Returns the N installs with the lowest
//       current score, plus their signal mix.
//
// The dashboard Posture > Trust tab consumes the second endpoint;
// the SDK `sentori.queryTrustScore()` helper hits the first.

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::error::{AppError, err_response_with};
use crate::recent::AppState;

/// Default weight table baked into the binary. Tuned so a single
/// pin mismatch costs 30 (operator-visible) but non-event activity
/// stays at 100. Operators can override per-kind via the
/// `SENTORI_TRUST_WEIGHTS` env var (audit-closeout F).
fn default_weight(kind: &str) -> i32 {
    match kind {
        "pin.mismatch" => 30,
        "root.detected" => 50,
        "frida.detected" => 50,
        "jailbreak.detected" => 50,
        "debugger.attached" => 20,
        "device.emulator" => 10,
        _ => 5,
    }
}

/// v1.1 audit-closeout F — operator-configurable trust weight table.
/// Constructed from the `SENTORI_TRUST_WEIGHTS` env var at process
/// boot (lazily on first `weight()` call). Format:
///
///     SENTORI_TRUST_WEIGHTS=pin.mismatch=40,root.detected=60
///
/// Missing kinds fall back to the compiled-in default table. Bad
/// entries (non-integer values, missing `=`) are silently skipped so
/// a partially-malformed env var still degrades sanely.
pub struct Weights {
    overrides: HashMap<String, i32>,
}

impl Weights {
    pub fn parse(spec: &str) -> Self {
        let mut overrides = HashMap::new();
        for pair in spec.split(',') {
            if let Some((k, v)) = pair.split_once('=') {
                if let Ok(n) = v.trim().parse::<i32>() {
                    let kind = k.trim();
                    if !kind.is_empty() {
                        overrides.insert(kind.to_string(), n);
                    }
                }
            }
        }
        Self { overrides }
    }

    pub fn get(&self, kind: &str) -> i32 {
        if let Some(v) = self.overrides.get(kind) {
            return *v;
        }
        default_weight(kind)
    }
}

static GLOBAL_WEIGHTS: LazyLock<Weights> = LazyLock::new(|| {
    match std::env::var("SENTORI_TRUST_WEIGHTS") {
        Ok(spec) if !spec.trim().is_empty() => {
            let w = Weights::parse(&spec);
            tracing::info!(
                overrides = w.overrides.len(),
                "loaded SENTORI_TRUST_WEIGHTS overrides"
            );
            w
        }
        _ => Weights {
            overrides: HashMap::new(),
        },
    }
});

/// Per-kind score penalty, honouring the env-configured override
/// table if any. Free function so `score_from_counts` (and the
/// proptest harness underneath it) doesn't have to thread context.
pub fn weight(kind: &str) -> i32 {
    GLOBAL_WEIGHTS.get(kind)
}

const WINDOW_HOURS: i64 = 24;
pub const BASELINE: i32 = 100;

/// Pure math kernel. Given a list of (kind, count) tuples, returns
/// the (score, signals) pair. Extracted from `compute_score` so the
/// proptest harness can verify invariants without a database:
///   - score is always in [0, 100]
///   - adding more events to any kind never raises the score
///   - the result is order-independent
///   - empty input yields BASELINE with no signals
pub fn score_from_counts(counts: &[(String, i64)]) -> (i32, Vec<TrustSignal>) {
    let mut signals: Vec<TrustSignal> = Vec::with_capacity(counts.len());
    let mut penalty: i32 = 0;
    for (kind, count) in counts {
        let w = weight(kind);
        let take = w.saturating_mul((*count).min(i32::MAX as i64).max(0) as i32);
        penalty = penalty.saturating_add(take);
        signals.push(TrustSignal {
            kind: kind.clone(),
            count: *count,
            weight: w,
        });
    }
    let score = (BASELINE - penalty).clamp(0, 100);
    (score, signals)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustSignal {
    pub kind: String,
    pub count: i64,
    pub weight: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustScore {
    pub install_id: String,
    pub score: i32,
    pub signals: Vec<TrustSignal>,
    #[serde(with = "time::serde::rfc3339")]
    pub computed_at: OffsetDateTime,
}

async fn compute_score(
    pool: &PgPool,
    project_id: Uuid,
    install_id: &str,
) -> Result<TrustScore, AppError> {
    let since = OffsetDateTime::now_utc() - time::Duration::hours(WINDOW_HOURS);
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT kind, COUNT(*)::bigint \
         FROM security_events \
         WHERE project_id = $1 AND install_id = $2 AND occurred_at >= $3 \
         GROUP BY kind",
    )
    .bind(project_id)
    .bind(install_id)
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let (score, signals) = score_from_counts(&rows);
    Ok(TrustScore {
        install_id: install_id.to_string(),
        score,
        signals,
        computed_at: OffsetDateTime::now_utc(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreParams {
    pub install_id: Option<String>,
}

/// `GET /v1/security/score?installId=<id>` — SDK-facing.
pub async fn sdk_score(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Query(params): Query<ScoreParams>,
) -> Response {
    let project_id = caller_project_id(&caller, &state);
    let Some(install_id) = params.install_id else {
        return err_response_with(
            StatusCode::BAD_REQUEST,
            "trust.missingInstallId",
            "query parameter `installId` is required",
            Some("call sentori.getInstallId() first to obtain it".to_string()),
            Some("https://sentori.golia.jp/docs/errors/trust.missingInstallId".to_string()),
            "domain.security",
            vec![],
        );
    };
    if install_id.is_empty() || install_id.len() > 64 {
        return err_response_with(
            StatusCode::BAD_REQUEST,
            "trust.invalidInstallId",
            "installId must be 1..64 chars",
            None,
            None,
            "domain.security",
            vec![],
        );
    }
    let Some(pool) = &state.db else {
        // No DB → baseline. Better than 503 because the SDK's
        // cache strategy treats "score=100" as the safe default.
        return Json(TrustScore {
            install_id,
            score: BASELINE,
            signals: vec![],
            computed_at: OffsetDateTime::now_utc(),
        })
        .into_response();
    };
    match compute_score(pool, project_id, &install_id).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListParams {
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustScoreRow {
    pub install_id: String,
    pub score: i32,
    pub event_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
    pub kinds: BTreeMap<String, i64>,
}

/// `GET /admin/api/projects/{id}/trust/scores?limit=...` — Posture
/// dashboard list. Returns the N installs with the LOWEST current
/// score (worst first), so the operator's eye lands on suspicious
/// installs immediately.
pub async fn list_low_scores(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<ListParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<TrustScoreRow>::new()).into_response());
    };
    let limit = params.limit.unwrap_or(50).clamp(1, 500);
    let since = OffsetDateTime::now_utc() - time::Duration::hours(WINDOW_HOURS);

    // Pull every (install_id, kind) tuple in the window then fold in
    // Rust. For projects with > ~100k security rows in 24h we'd want
    // a server-side aggregation; the current shape is correct + small
    // enough for the v1.1 verify.
    let rows: Vec<(String, String, i64, OffsetDateTime)> = sqlx::query_as(
        "SELECT install_id, kind, COUNT(*)::bigint, MAX(occurred_at) \
         FROM security_events \
         WHERE project_id = $1 AND install_id IS NOT NULL AND occurred_at >= $2 \
         GROUP BY install_id, kind",
    )
    .bind(project_id)
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    type Acc = (i32, i64, OffsetDateTime, BTreeMap<String, i64>);
    let mut agg: BTreeMap<String, Acc> = BTreeMap::new();
    for (install_id, kind, count, last_seen) in rows {
        let w = weight(&kind);
        let penalty = w.saturating_mul(count.min(i32::MAX as i64) as i32);
        let entry = agg
            .entry(install_id)
            .or_insert((0, 0, last_seen, BTreeMap::new()));
        entry.0 = entry.0.saturating_add(penalty);
        entry.1 = entry.1.saturating_add(count);
        if last_seen > entry.2 {
            entry.2 = last_seen;
        }
        entry.3.insert(kind, count);
    }
    let mut out: Vec<TrustScoreRow> = agg
        .into_iter()
        .map(|(install_id, (pen, ec, ls, kinds))| TrustScoreRow {
            install_id,
            score: (BASELINE - pen).clamp(0, 100),
            event_count: ec,
            last_seen: ls,
            kinds,
        })
        .collect();
    out.sort_by(|a, b| a.score.cmp(&b.score).then_with(|| b.last_seen.cmp(&a.last_seen)));
    out.truncate(limit as usize);
    Ok(Json(out).into_response())
}

// ── v1.1 audit-closeout E: `/v1/security/score:stream` REMOVED ────────
//
// The SSE backplane was scoped for S3 but pulled before v1.1 actually
// shipped. The handler did a 10s polling loop per subscriber against
// Postgres — at 1 000 connected installs that's 100 QPS just for
// trust-score heartbeats, and worse: the cost is per-connection
// instead of per-event-change. v1.2 will redo this with LISTEN/NOTIFY
// driven by `security:report` ingest writes (push, not poll).
//
// Until then SDKs use `sentori.queryTrustScore()` polling cache
// (L1 30 s + L2 5 min via MMKV/AsyncStorage); the freshness loss is
// at most 30 s and the host app stays sub-1% main thread.

// ── v1.1 P4 — property tests for the scoring math kernel ────────────────
//
// Pure math, so no DB / async involved. Properties checked:
//
//   1. Score is always in [0, 100], regardless of input.
//   2. More events of any kind never raise the score (monotonicity).
//   3. Result is order-independent: scoring [a, b] == scoring [b, a].
//   4. Empty input yields BASELINE (100) with no signals.
//   5. Adding an unknown kind subtracts exactly the unknown-default
//      weight (5) per occurrence.
//
// Run with: `cargo test -p sentori-server --lib api::trust_score`.

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    /// Strategy: generate up to 16 (kind, count) pairs where kind is
    /// one of the known weights or a random short string (exercises
    /// the unknown-kind path), and count is a reasonable bound.
    fn count_vec_strategy() -> impl Strategy<Value = Vec<(String, i64)>> {
        let known = prop::sample::select(vec![
            "pin.mismatch".to_string(),
            "root.detected".to_string(),
            "frida.detected".to_string(),
            "jailbreak.detected".to_string(),
            "debugger.attached".to_string(),
            "device.emulator".to_string(),
        ]);
        let unknown = "[a-z]{3,12}".prop_map(|s: String| format!("custom.{s}"));
        let kind = prop_oneof![known, unknown];
        let count = 0i64..1_000_000i64;
        prop::collection::vec((kind, count), 0..16)
    }

    proptest! {
        /// Score never escapes [0, 100], even for absurd event counts.
        #[test]
        fn score_in_bounds(counts in count_vec_strategy()) {
            let (score, _) = score_from_counts(&counts);
            prop_assert!((0..=100).contains(&score), "score {score} out of [0, 100]");
        }

        /// Adding more events to any kind cannot raise the score.
        #[test]
        fn monotonic_under_more_events(
            counts in count_vec_strategy(),
            idx in 0usize..16,
            extra in 1i64..1000i64,
        ) {
            if counts.is_empty() { return Ok(()); }
            let i = idx % counts.len();
            let (base_score, _) = score_from_counts(&counts);
            let mut larger = counts.clone();
            larger[i].1 = larger[i].1.saturating_add(extra);
            let (new_score, _) = score_from_counts(&larger);
            prop_assert!(
                new_score <= base_score,
                "score rose: {base_score} -> {new_score} after +{extra} on idx {i}"
            );
        }

        /// Result is order-independent: scoring is a fold over the
        /// sum of weight*count, which is commutative.
        #[test]
        fn order_independent(counts in count_vec_strategy()) {
            if counts.is_empty() { return Ok(()); }
            let (score_a, _) = score_from_counts(&counts);
            let mut reversed = counts.clone();
            reversed.reverse();
            let (score_b, _) = score_from_counts(&reversed);
            prop_assert_eq!(score_a, score_b);
        }
    }

    #[test]
    fn empty_input_is_baseline() {
        let (score, signals) = score_from_counts(&[]);
        assert_eq!(score, BASELINE);
        assert!(signals.is_empty());
    }

    #[test]
    fn unknown_kind_subtracts_default_weight() {
        let counts = vec![("custom.totally-novel".to_string(), 3)];
        let (score, signals) = score_from_counts(&counts);
        assert_eq!(score, BASELINE - 3 * 5);
        assert_eq!(signals.len(), 1);
        assert_eq!(signals[0].weight, 5);
    }

    // ── v1.1 audit-closeout F: SENTORI_TRUST_WEIGHTS unit tests ───────

    #[test]
    fn weights_parse_overrides_known_kinds() {
        let w = Weights::parse("pin.mismatch=42, root.detected=80 , custom.foo=7");
        assert_eq!(w.get("pin.mismatch"), 42);
        assert_eq!(w.get("root.detected"), 80);
        assert_eq!(w.get("custom.foo"), 7);
        // un-overridden kinds keep the default
        assert_eq!(w.get("frida.detected"), 50);
        assert_eq!(w.get("device.emulator"), 10);
        // truly unknown kind falls back to the catch-all
        assert_eq!(w.get("anything.else"), 5);
    }

    #[test]
    fn weights_parse_skips_malformed_pairs() {
        // bad: missing `=`, missing key, missing value, non-int value
        let w = Weights::parse(
            "pin.mismatch=42,no_equals_sign,=42,root.detected=,frida.detected=not_a_number",
        );
        assert_eq!(w.get("pin.mismatch"), 42, "good pair survives");
        assert_eq!(
            w.get("root.detected"),
            50,
            "malformed entries fall back to default"
        );
        assert_eq!(w.get("frida.detected"), 50);
    }

    #[test]
    fn weights_empty_spec_is_empty_override_table() {
        let w = Weights::parse("");
        assert_eq!(w.overrides.len(), 0);
        assert_eq!(w.get("pin.mismatch"), 30);
    }
}

