pub mod activity_log;
pub mod api;
pub mod attachments;
pub mod audit;
pub mod cert_monitor;
pub mod integrations;
pub mod auth;
pub mod db;
pub mod digest;
pub mod error;
pub mod event;
pub mod geoip;
pub mod grouping;
pub mod identity;
pub mod correlation_id;
pub mod error_envelope;
pub mod issues;
pub mod live_presence;
pub mod mailer;
pub mod metrics;
/// v2.1 W1 — hourly partition lifecycle for `runtime_metrics_raw`.
/// Pure Postgres (no pg_partman / Timescale), CREATE TABLE IF
/// NOT EXISTS … PARTITION OF … per day; daily DROP for 90-day
/// retention. See docs/design/v2-metrics.md.
pub mod metrics_partition;
/// v2.1 W1 — runtime metrics rollup cron. 60 s tick raw → _1m
/// (with 10 s late-arrival safety margin), hourly _1m → _1h,
/// daily _1h → _1d. Schema in migrations 0068 / 0069.
pub mod metrics_rollup;
pub mod notification_digest;
pub mod notification_email;
pub mod notifications;
pub mod notifier;
pub mod passwd;
pub mod privacy_lab;
pub mod quotas;
pub mod regression;
pub mod retention;
pub mod rule_eval;
pub mod velocity;
pub mod rate_limit;
pub mod recent;
pub mod roles;
pub mod router;
pub mod seed;
pub mod session;
pub mod source_bundle;
pub mod symbolicate;
pub mod symbolicate_android;
pub mod symbolicate_ios;
pub mod trace_emit;
pub mod tracing_middleware;
pub mod valkey;
pub mod webhook;
pub mod webhook_dispatch;
