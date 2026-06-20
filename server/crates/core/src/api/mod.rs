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
/// v2.1 W4 — admin CRUD + probe log + 1h rollup query for endpoint
/// health checks. Probes themselves are driven by the
/// `endpoint_probe` cron module in the crate root.
pub mod endpoint_checks;
// Phase A.1 Stage B-3 — orgs 删 (per §08 identity 重整 + sprint-0/S14).
// orgs → tenants (saas crate). Workspace 内 member CRUD 在新 workspace_members
// module (B-3c+ 加). API 路径 /orgs/* 暂时全 410 Gone 或路由删 (router.rs).
// pub mod orgs;
pub mod privacy;
pub mod projects;
/// v2.7 — push notification subsystem HTTP routes (token register /
/// send / receipts + Expo-compat alt endpoints). Sits on the
/// ingestion router with Bearer + rate-limit middleware.
pub mod push;
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
// Phase A.1 Stage B-3 — teams 删 (per §08).
// teams → enterprise/project_groups (v0.2+);现 visibility 走 project_user_visibility.
// pub mod teams;
pub mod tokens;
pub mod traces;
pub mod track;
pub mod trust_score;
pub mod user_auth;
pub mod user_reports;
pub mod views;
pub mod vitals;

// Phase A.1 Stage B-3 transitional stub —
// teams module 删后, api/alert_rules.rs + api/views.rs 仍引用
// `resolve_membership(pool, slug, user_id) -> Option<(org_id, role_string)>`.
// B-3c+ 把这两个 module rewrite 成 workspace_members + project_id-based 后
// 此 stub 删。 stub 暂时永远 None 让 cargo 通 + 这两个 module API 暂时
// 全返 404 (consumer 看到 orgNotFound, 不破坏 cargo build)。
pub async fn resolve_membership(
    _pool: &sqlx::PgPool,
    _slug: &str,
    _user_id: uuid::Uuid,
) -> Option<(uuid::Uuid, String)> {
    None
}
