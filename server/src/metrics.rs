// Phase 16 sub-B: Prometheus metrics exporter.
//
// Exposes a `/metrics` endpoint scraped by Prometheus / Grafana Cloud.
// Names follow `<namespace>_<unit>_<suffix>`:
//   sentori_ingest_total{status="accepted|rejected|quota_exceeded"}
//   sentori_ingest_duration_seconds (histogram)
//   sentori_quota_drops_total
//
// IMPORTANT: with metrics 0.24 + metrics-exporter-prometheus 0.16,
// calling `metrics::counter!(...)` repeatedly for the same key creates
// fresh disposable handles whose increments do *not* combine. We cache
// per-key handles in `OnceLock<Counter>` / `OnceLock<Histogram>` so the
// hot path always increments the same backing atomic.

use std::sync::OnceLock;

use metrics::{Counter, Histogram};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};

/// Install the global recorder. Call once at process start; the
/// returned handle is what `/metrics` renders to text.
pub fn install() -> PrometheusHandle {
    PrometheusBuilder::new()
        .install_recorder()
        .expect("install prometheus recorder")
}

const INGEST_TOTAL: &str = "sentori_ingest_total";
const INGEST_DURATION: &str = "sentori_ingest_duration_seconds";
const QUOTA_DROPS: &str = "sentori_quota_drops_total";
const ISSUE_REGRESSED: &str = "sentori_issue_regressed_total";
const SYMB_LATENCY: &str = "sentori_symbolicate_duration_seconds";

static INGEST_ACCEPTED: OnceLock<Counter> = OnceLock::new();
static INGEST_REJECTED: OnceLock<Counter> = OnceLock::new();
static INGEST_QUOTA: OnceLock<Counter> = OnceLock::new();
static QUOTA_DROP: OnceLock<Counter> = OnceLock::new();
static INGEST_DUR: OnceLock<Histogram> = OnceLock::new();
static ISSUE_REGRESSED_C: OnceLock<Counter> = OnceLock::new();
static SYMB_COLD: OnceLock<Histogram> = OnceLock::new();
static SYMB_WARM: OnceLock<Histogram> = OnceLock::new();

pub fn ingest_accepted() {
    INGEST_ACCEPTED
        .get_or_init(|| metrics::counter!(INGEST_TOTAL, "status" => "accepted"))
        .increment(1);
}

pub fn ingest_rejected() {
    INGEST_REJECTED
        .get_or_init(|| metrics::counter!(INGEST_TOTAL, "status" => "rejected"))
        .increment(1);
}

pub fn ingest_quota_exceeded() {
    INGEST_QUOTA
        .get_or_init(|| metrics::counter!(INGEST_TOTAL, "status" => "quota_exceeded"))
        .increment(1);
}

pub fn quota_drop() {
    QUOTA_DROP
        .get_or_init(|| metrics::counter!(QUOTA_DROPS))
        .increment(1);
}

pub fn ingest_duration(secs: f64) {
    INGEST_DUR
        .get_or_init(|| metrics::histogram!(INGEST_DURATION))
        .record(secs);
}

pub fn issue_regressed() {
    ISSUE_REGRESSED_C
        .get_or_init(|| metrics::counter!(ISSUE_REGRESSED))
        .increment(1);
}

/// Record source map load latency. `cold = true` for the first
/// access per release (DB lookup + file read + parse); `false` for
/// the cached path (Arc clone out of a Mutex<HashMap>).
pub fn symbolicate_duration(cold: bool, secs: f64) {
    if cold {
        SYMB_COLD
            .get_or_init(|| metrics::histogram!(SYMB_LATENCY, "cache" => "cold"))
            .record(secs);
    } else {
        SYMB_WARM
            .get_or_init(|| metrics::histogram!(SYMB_LATENCY, "cache" => "warm"))
            .record(secs);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_accumulate_across_calls() {
        let handle = install();
        for _ in 0..3 {
            ingest_accepted();
        }
        for _ in 0..2 {
            ingest_rejected();
        }
        let rendered = handle.render();
        assert!(
            rendered.contains("sentori_ingest_total{status=\"accepted\"} 3"),
            "expected accepted=3, got:\n{rendered}"
        );
        assert!(
            rendered.contains("sentori_ingest_total{status=\"rejected\"} 2"),
            "expected rejected=2, got:\n{rendered}"
        );
    }
}
