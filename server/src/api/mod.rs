pub mod admin;
pub mod admin_auth;
pub mod alert_rules;
pub mod attachments;
pub mod audience_metrics;
pub mod behavior;
pub mod cert_monitor;
pub mod culprits;
pub mod deploys;
pub mod integrations;
pub mod digests;
pub mod dsyms;
pub mod events;
pub mod events_batch;
pub mod events_stream;
pub mod federation;
pub mod health;
pub mod heartbeat;
pub mod live;
pub mod live_debug;
pub mod mappings;
pub mod metrics;
pub mod moments;
pub mod oauth;
/// v2.1 W1 — auto-instrument runtime metrics ingest. Separate
/// from `metrics` (which carries the v0.8.3 recordMetric custom
/// channel) because the validation rules, storage shape, and
/// rate-limit budget all differ. Writes to `runtime_metrics_raw`
/// (partitioned-by-day) and is rolled up by `metrics_rollup`.
pub mod runtime_metrics;
/// v2.1 W3 — dashboard BI query endpoint for runtime metrics.
/// Reads from the rollup tier (raw / _1m / _1h / _1d) appropriate
/// for the requested (bucket, from, to) window.
pub mod runtime_metrics_query;
pub mod orgs;
pub mod privacy;
pub mod projects;
pub mod recent;
pub mod recipients;
pub mod repro;
pub mod releases;
pub mod search;
pub mod security;
pub mod self_test;
pub mod source_bundle;
pub mod sessions;
pub mod superadmin;
pub mod spans;
pub mod teams;
pub mod tokens;
pub mod traces;
pub mod track;
pub mod trust_score;
pub mod user_auth;
pub mod user_reports;
pub mod views;
pub mod vitals;
