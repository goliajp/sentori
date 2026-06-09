use axum::{
    Router,
    extract::DefaultBodyLimit,
    http,
    middleware,
    routing::{get, patch, post},
};
use metrics_exporter_prometheus::PrometheusHandle;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

use crate::api;
use crate::auth::{AuthState, require_token};
use crate::recent::{AppState, RecentBuffer};

/// Global outer cap applied to every route. Sized to the *largest*
/// per-route inner cap so admin uploads (dsym / mapping / sourcemap
/// at 256 MB each, see MAX_ADMIN_UPLOAD_BYTES) can actually use their
/// budget. Tower layers stack from outside in — an outer cap below
/// an inner cap silently dominates; Insight 2026-05-18 hit this
/// shape twice: first with the 1 MB → 16 MB bump for replay
/// attachment, then with a 37 MB Android packager.map sourcemap
/// that still blew through 16 MB despite the per-route 256 MB
/// override. Small-payload ingest routes (events / spans /
/// sessions / etc.) self-limit via explicit per-route 1 MB layers
/// declared at the route below — they never see this outer cap.
const MAX_BODY_BYTES: usize = 256 * 1024 * 1024;
// Phase 22 sub-A: dSYM uploads can run up to ~256 MB per arch slice;
// release / sourcemap / dsym admin routes opt out of the outer cap
// via DefaultBodyLimit::disable() and rely on per-handler validation.
const MAX_ADMIN_UPLOAD_BYTES: usize = 256 * 1024 * 1024;

/// Per-route ingest cap for the attachment POST. Replay NDJSON for
/// dense screens (Insight 2026-05-18: 82 nodes × 60 frames ≈ 1.5 MB
/// per crash) blew through the 1 MB global default; 16 MB keeps
/// dense-UI replay accepted while still bounding abuse.
const MAX_INGEST_ATTACHMENT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Default)]
pub struct ServerConfig {
    pub dev_token: String,
    pub db: Option<sqlx::PgPool>,
    pub valkey: Option<redis::aio::ConnectionManager>,
    pub project_id: uuid::Uuid,
    pub rate_limit_per_min: u32,
    pub admin_password: String,
    pub session_secret: String,
    pub notifier_tx: Option<tokio::sync::mpsc::Sender<crate::notifier::NotifyEvent>>,
    pub base_url: String,
    /// Optional Prometheus handle. When set, `/metrics` renders the
    /// current snapshot. Caddy is expected to scope public access in
    /// production; we don't gate it server-side because Prometheus
    /// scrape runs without auth on the internal network.
    pub metrics: Option<PrometheusHandle>,
    /// Phase 37 sub-A: if set, every request emits an `http.server`
    /// span into the trace buffer, batched + persisted to spans /
    /// traces tables by the emitter's background flush task.
    pub self_trace: Option<crate::trace_emit::SpanEmitter>,
    /// Phase 42 sub-C.02: attachment backing store. `Default` puts
    /// a `NoopAttachmentStore` here so tests don't need to wire it.
    pub attachments: Option<crate::attachments::SharedAttachmentStore>,
    /// v0.8.0-d — GeoIP DB path (env `SENTORI_GEOIP_DB_PATH`).
    /// `None` skips enrichment; tests don't need to load a real db.
    pub geoip_db_path: Option<std::path::PathBuf>,
    /// v1.1 chunk S1 — optional ASN DB path (env `SENTORI_ASN_DB_PATH`).
    /// Loaded on top of `geoip_db_path`; lookup returns ASN fields
    /// only when both readers find the IP. `None` skips ASN
    /// enrichment without affecting the City lookup.
    pub asn_db_path: Option<std::path::PathBuf>,
    /// v2.21 — shared push provider registry. main.rs builds this
    /// once so dispatch_cron and the admin verify endpoint use the
    /// same `Arc<Providers>` (same JWT/OAuth caches, same quarantine
    /// state). Tests + back-compat: `None` causes router::build to
    /// construct its own, but production main.rs passes `Some`.
    pub push_providers: Option<std::sync::Arc<crate::push::providers::Providers>>,
}

pub fn build(cfg: ServerConfig) -> Router {
    let auth_state = AuthState::new(cfg.dev_token, cfg.db.clone());
    let recent = RecentBuffer::new();
    let cfg_self_trace_clone = cfg.self_trace.clone();
    // Phase 50 sub-A1: 128-slot broadcast channel for the live event
    // SSE feed. Capacity is the number of in-flight ticks a slow
    // subscriber can buffer before the channel drops older ones —
    // 128 covers a 1-2s burst at typical dev-time rates.
    let (event_ticks_tx, _) =
        tokio::sync::broadcast::channel::<crate::recent::EventTick>(128);
    // v0.9.3 +S7: live-debug full-event fan-out. Small buffer (32);
    // a slow subscriber drops events rather than slowing ingest.
    let (live_events_tx, _) =
        tokio::sync::broadcast::channel::<crate::recent::LiveEvent>(32);
    // v0.8.0-d — load the optional GeoIP db once at startup. Load
    // failure is non-fatal: log and run without enrichment.
    // v1.1 chunk S1 — chain an optional ASN db on top. ASN load
    // failure leaves the City reader intact; geographic enrichment
    // keeps working without ASN.
    let geoip = cfg.geoip_db_path.as_ref().and_then(|p| {
        match crate::geoip::GeoIpReader::load(p) {
            Ok(r) => {
                tracing::info!(path = %p.display(), "geoip db loaded");
                Some(r)
            }
            Err(e) => {
                tracing::warn!(error = %e, path = %p.display(), "geoip db load failed; running without enrichment");
                None
            }
        }
    });
    let geoip = geoip.map(|reader| {
        match cfg.asn_db_path.as_ref() {
            Some(p) => match reader.clone().with_asn(p) {
                Ok(r) => {
                    tracing::info!(path = %p.display(), "asn db loaded");
                    r
                }
                Err(e) => {
                    tracing::warn!(error = %e, path = %p.display(), "asn db load failed; running without asn enrichment");
                    reader
                }
            },
            None => reader,
        }
    });
    // v2.7 — single shared outbound client. Reused by push providers
    // and any future outbound integration; webhook + integrations
    // backfill is a follow-up. Logging the build failure rather than
    // panicking — if the platform somehow can't construct a HTTP
    // client we fall back to reqwest's defaults via Client::new().
    let http_client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "shared http_client build failed; falling back to default");
            reqwest::Client::new()
        });
    // v2.21 — Providers comes from main.rs via ServerConfig so
    // dispatch_cron + admin verify endpoint share the same instance
    // (same JWT/OAuth caches, same quarantine state). Tests that
    // don't supply one get a fresh local registry.
    let push_providers = cfg.push_providers.unwrap_or_else(|| {
        std::sync::Arc::new(crate::push::providers::Providers::new())
    });
    let state = AppState {
        auth: auth_state.clone(),
        recent,
        db: cfg.db,
        valkey: cfg.valkey,
        project_id: cfg.project_id,
        rate_limit_per_min: cfg.rate_limit_per_min,
        admin_password: cfg.admin_password,
        session_secret: cfg.session_secret,
        notifier_tx: cfg.notifier_tx,
        base_url: cfg.base_url,
        attachments: cfg
            .attachments
            .unwrap_or_else(|| std::sync::Arc::new(crate::attachments::NoopAttachmentStore)),
        event_ticks: std::sync::Arc::new(event_ticks_tx),
        live_events: std::sync::Arc::new(live_events_tx),
        live_targets: std::sync::Arc::new(tokio::sync::RwLock::new(
            std::collections::HashMap::new(),
        )),
        geoip,
        http_client,
        push_providers: Some(push_providers),
        send_gate: std::sync::Arc::new(crate::push::send_gate::SendGate::new()),
    };

    // Per-route body-stream cap for small-payload ingest endpoints.
    // Without this each route would inherit the 16 MB outer cap and
    // a wedged client could keep us reading 16 MB of garbage before
    // the JSON parser rejects it. 1 MB is generous for a single
    // event / span batch / session ping.
    let small_body = RequestBodyLimitLayer::new(1024 * 1024);
    let ingestion = Router::new()
        .route("/v1/events", post(api::events::handle).layer(small_body.clone()))
        .route("/v1/events:batch", post(api::events_batch::handle).layer(small_body.clone()))
        .route("/v1/heartbeat", post(api::heartbeat::handle).layer(small_body.clone()))
        .route("/v1/events/_recent", get(api::recent::handle))
        .route("/v1/deploys", post(api::deploys::handle).layer(small_body.clone()))
        .route("/v1/sessions", post(api::sessions::handle).layer(small_body.clone()))
        .route("/v1/spans", post(api::spans::handle).layer(small_body.clone()))
        .route("/v1/spans:batch", post(api::spans::handle_batch).layer(small_body.clone()))
        // v0.8.2 — end-user feedback submitted from inside the host app.
        .route("/v1/user-reports", post(api::user_reports::ingest).layer(small_body.clone()))
        // v0.8.3 — custom metrics (counters / gauges / timings) from
        // the host app. Up to 500 points per batch.
        .route("/v1/metrics:batch", post(api::metrics::ingest_batch).layer(small_body.clone()))
        // v2.1 W1 — auto-instrument runtime metrics. Sibling of
        // /v1/metrics:batch; writes to runtime_metrics_raw
        // (partitioned by day, rolled up by metrics_rollup) and
        // applies a stricter name regex + tag cardinality cap.
        .route(
            "/v1/runtime-metrics:batch",
            post(api::runtime_metrics::ingest_batch).layer(small_body.clone()),
        )
        // v1.1 chunk B — analytics `track` events (page views, custom
        // funnels). Separate table + endpoint from /v1/events so the
        // high-volume analytics path doesn't share the error retention
        // loop. Up to 500 events per batch.
        .route("/v1/track:batch", post(api::track::handle_batch).layer(small_body.clone()))
        // v1.1 chunk S2 — security event reports (pin mismatches,
        // root detection, …). Single event per call (low volume by
        // nature); separate `security_events` table for divergent
        // retention + trust-scoring access patterns.
        .route("/v1/security:report", post(api::security::report).layer(small_body.clone()))
        // v1.1 chunk S3 — SDK-facing trust score query. Reads
        // security_events for the caller's installId and computes
        // a 0-100 score on the fly.
        //
        // The `/v1/security/score:stream` SSE backplane was scoped
        // for v1.1 but pulled before ship: a 10s poll loop per
        // subscriber doesn't scale past ~100 connected installs
        // before Postgres becomes the bottleneck. v1.2 will redo
        // this with LISTEN/NOTIFY driven by `security:report`
        // ingest writes. SDKs use the polling `queryTrustScore()`
        // cache (L1 30s + L2 5min) in the meantime.
        .route("/v1/security/score", get(api::trust_score::sdk_score))
        // v1.1 chunk S4 — federated identity link upsert. SDK calls
        // on every sign-in; idempotent on (project, provider, subject).
        .route("/v1/security/link", post(api::federation::link).layer(small_body.clone()))
        // v1.1 +S7 升级 — SDK polls this every ~30s to discover its
        // live-mode flag. SDK enters immediate-send mode when set.
        .route("/v1/control/poll", get(api::live_debug::poll))
        // v2.7 — push notification subsystem.
        //   POST /v1/push/tokens               — register / refresh device handle
        //   DELETE /v1/push/tokens/{handle}    — revoke
        //   POST /v1/push/send                 — Sentori-native send (single or array)
        //   GET  /v1/push/receipts/{send_id}   — receipt
        //   POST /v1/push/expo-compat/send     — Expo wire-shape adapter
        //   GET  /v1/push/expo-compat/receipts/{send_id}
        // All inherit small_body cap, rate_limit, require_token.
        .route(
            "/v1/push/tokens",
            post(api::push::register_token).layer(small_body.clone()),
        )
        .route(
            "/v1/push/tokens/{handle}",
            axum::routing::delete(api::push::revoke_token),
        )
        .route(
            "/v1/push/send",
            post(api::push::send_native).layer(small_body.clone()),
        )
        .route(
            "/v1/push/receipts/{send_id}",
            get(api::push::get_receipt),
        )
        .route(
            "/v1/push/expo-compat/send",
            post(api::push::send_expo_compat).layer(small_body.clone()),
        )
        .route(
            "/v1/push/expo-compat/receipts/{send_id}",
            get(api::push::get_receipt_expo_compat),
        )
        .route(
            "/v1/events/{event_id}/attachments/{kind}",
            post(api::attachments::upload).layer((
                DefaultBodyLimit::disable(),
                RequestBodyLimitLayer::new(MAX_INGEST_ATTACHMENT_BYTES),
            )),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            crate::rate_limit::rate_limit_middleware,
        ))
        .route_layer(middleware::from_fn_with_state(auth_state, require_token));

    let admin_protected = Router::new()
        .route("/projects", get(api::admin::list_my_projects))
        .route("/search", get(api::search::handle))
        .route(
            "/orgs/{slug}/projects",
            post(api::projects::create_project),
        )
        .route(
            "/projects/{project_id}",
            patch(api::projects::patch_project),
        )
        // Phase 43 sub-A.03: typed integration adapters.
        .route("/integrations", get(api::integrations::list_integrations))
        .route(
            "/integrations/{kind}/connect",
            get(api::integrations::connect),
        )
        .route(
            "/integrations/{kind}/callback",
            get(api::integrations::callback),
        )
        .route(
            "/integrations/{kind}",
            axum::routing::delete(api::integrations::revoke),
        )
        .route(
            "/integrations/{kind}/configure",
            post(api::integrations::configure),
        )
        // v1.2 W8 — per-user notification inbox + SSE stream.
        .route(
            "/notifications",
            get(api::admin::list_notifications),
        )
        .route(
            "/notifications/{id}/read",
            post(api::admin::mark_read),
        )
        .route(
            "/notifications/read-all",
            post(api::admin::mark_all_read),
        )
        .route(
            "/notifications/stream",
            get(api::admin::notification_stream),
        )
        // v1.3 W14 — per-user notification preferences.
        .route(
            "/account/notification-preferences",
            get(api::admin::get_notification_preferences)
                .put(api::admin::put_notification_preferences),
        )
        // v1.4 W16 — diagnostic: send a test email to the caller.
        .route(
            "/account/notification-preferences/test-email",
            post(api::admin::send_test_email),
        )
        // v1.4 W17 — diagnostic: trigger the digest worker for caller now.
        .route(
            "/account/notification-preferences/run-digest-now",
            post(api::admin::run_digest_now),
        )
        // v1.4 W22 — webhook delivery list + manual retry.
        .route(
            "/webhook-deliveries",
            get(api::admin::list_webhook_deliveries),
        )
        .route(
            "/webhook-deliveries/{id}/retry",
            post(api::admin::retry_webhook_delivery),
        )
        // v1.4 W23 — cross-org integration sharing / templating.
        .route(
            "/account/integration-templates",
            get(api::admin::list_templates).post(api::admin::create_template),
        )
        .route(
            "/account/integration-templates/{id}",
            axum::routing::put(api::admin::update_template).delete(api::admin::delete_template),
        )
        .route(
            "/account/integration-templates/{id}/apply",
            post(api::admin::apply_template),
        )
        // v1.4 W24 — per-org label catalog.
        .route(
            "/orgs/{org_slug}/labels",
            get(api::admin::list_labels).post(api::admin::create_label),
        )
        .route(
            "/orgs/{org_slug}/labels/{id}",
            axum::routing::patch(api::admin::update_label)
                .delete(api::admin::delete_label),
        )
        .route(
            "/projects/{project_id}/teams",
            get(api::teams::list_project_teams),
        )
        .route(
            "/projects/{project_id}/teams/{team_slug}",
            post(api::teams::assign_project_to_team)
                .delete(api::teams::unassign_project_from_team),
        )
        .route(
            "/projects/{project_id}/tokens",
            get(api::tokens::list_tokens).post(api::tokens::create_token),
        )
        .route(
            "/projects/{project_id}/tokens/{token_id}",
            axum::routing::delete(api::tokens::revoke_token),
        )
        // v2.7 W10 — push credential CRUD (APNs p8 / FCM service-
        // account JSON / VAPID private key / HCM appSecret / MiPush
        // appSecret). The encrypted secret blob is never returned;
        // GET surfaces only `{ provider, config, updated_at }`.
        .route(
            "/projects/{project_id}/push/credentials",
            get(api::push::admin_list_credentials).put(api::push::admin_upsert_credential),
        )
        .route(
            "/projects/{project_id}/push/credentials/{provider}",
            axum::routing::delete(api::push::admin_delete_credential),
        )
        // v2.19 — push monitoring + management surface. Powers the
        // Push module's Overview/Devices/Sends/Credentials tabs and
        // the new Push fleet module under the manage group.
        .route(
            "/projects/{project_id}/push/stats",
            get(api::push::admin_push_stats),
        )
        .route(
            "/projects/{project_id}/push/devices",
            get(api::push::admin_list_push_devices),
        )
        .route(
            "/projects/{project_id}/push/sends",
            get(api::push::admin_list_push_sends),
        )
        .route(
            "/projects/{project_id}/push/sends/{send_id}",
            get(api::push::admin_get_push_send_detail),
        )
        .route(
            "/projects/{project_id}/push/sends/{send_id}/retry",
            post(api::push::admin_retry_push_send),
        )
        .route(
            "/projects/{project_id}/push/credentials/{provider}/verify",
            post(api::push::admin_verify_push_credential),
        )
        .route(
            "/orgs/{org_slug}/push/projects",
            get(api::push::admin_list_org_push_projects),
        )
        .route(
            "/projects/{project_id}/issues",
            get(api::admin::list_issues),
        )
        .route(
            "/projects/{project_id}/traces",
            get(api::traces::list_traces),
        )
        // v0.8.2 — user feedback inbox + per-issue reports.
        .route(
            "/projects/{project_id}/user-reports",
            get(api::user_reports::list_for_project),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/user-reports",
            get(api::user_reports::list_for_issue),
        )
        // v0.8.3 — custom metrics list + name summary.
        .route(
            "/projects/{project_id}/metrics",
            get(api::metrics::list_for_project),
        )
        .route(
            "/projects/{project_id}/metric-names",
            get(api::metrics::list_metric_names),
        )
        // v2.1 W3 — runtime metrics BI query. Picks the rollup
        // tier (raw / _1m / _1h / _1d) based on (bucket, from, to)
        // and returns one series per dim tuple.
        .route(
            "/projects/{project_id}/runtime-metrics/query",
            get(api::runtime_metrics_query::query),
        )
        // v2.1 W4 — endpoint health admin CRUD + probe log + 1h
        // rollup query. The probe cron itself spawns from main.rs.
        .route(
            "/projects/{project_id}/endpoint-checks",
            axum::routing::post(api::endpoint_checks::create)
                .get(api::endpoint_checks::list),
        )
        .route(
            "/projects/{project_id}/endpoint-checks/{id}",
            get(api::endpoint_checks::get_one)
                .put(api::endpoint_checks::update)
                .delete(api::endpoint_checks::delete),
        )
        .route(
            "/projects/{project_id}/endpoint-checks/{id}/probes",
            get(api::endpoint_checks::list_probes),
        )
        .route(
            "/projects/{project_id}/endpoint-checks/{id}/rollup",
            get(api::endpoint_checks::list_rollup),
        )
        // v2.1.3 — manual "probe now" dry-run; bypasses DB write +
        // issue lifecycle so an operator can verify a check without
        // polluting probe history.
        .route(
            "/projects/{project_id}/endpoint-checks/{id}/probe-now",
            axum::routing::post(api::endpoint_checks::probe_now),
        )
        // v0.9.0 #6 — moments aggregation + samples.
        .route(
            "/projects/{project_id}/moments",
            get(api::moments::list_for_project),
        )
        .route(
            "/projects/{project_id}/moments/{name}",
            get(api::moments::list_samples),
        )
        // v0.9.2 +S6 — Privacy Lab: per-release score + recent findings.
        .route(
            "/projects/{project_id}/privacy/score",
            get(api::privacy::score),
        )
        .route(
            "/projects/{project_id}/privacy/findings",
            get(api::privacy::findings),
        )
        // v0.9.11 — admin re-scan after a classifier upgrade. Wipes
        // findings + cursor for (project, optional release) and
        // synchronously re-runs the new classifier over the last 7d
        // of events so the score recovers without waiting for the
        // 7d window to age out stale rows.
        .route(
            "/projects/{project_id}/privacy/rescan",
            post(api::privacy::rescan),
        )
        // v0.9.2 +S5 — Repro-as-test: generate a Jest scaffold from
        // an event's breadcrumb trail + stack so the dev can drop it
        // into tests/__repros__/ and start debugging in 30 seconds.
        .route(
            "/projects/{project_id}/events/{event_id}/repro",
            get(api::repro::generate),
        )
        // v0.9.4 #1 — mobile vitals report + release list.
        .route(
            "/projects/{project_id}/vitals",
            get(api::vitals::report),
        )
        .route(
            "/projects/{project_id}/vitals/releases",
            get(api::vitals::list_releases),
        )
        // v0.9.3 +S7 — live debug stream (SSE).
        .route(
            "/projects/{project_id}/live-debug/users/{user_id}",
            get(api::live_debug::stream_user_events),
        )
        // v1.1 +S7 升级 — arm/disarm live-mode flag for a user_id.
        .route(
            "/projects/{project_id}/live-debug/users/{user_id}/arm",
            post(api::live_debug::arm_user).delete(api::live_debug::disarm_user),
        )
        // v0.9.3 +S3 — culprit commits per issue (manual mode).
        .route(
            "/projects/{project_id}/issues/{issue_id}/culprits",
            get(api::culprits::list_for_issue).post(api::culprits::attach),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/culprits/{culprit_id}",
            axum::routing::delete(api::culprits::detach),
        )
        // v1.1 +S3 升级 — on-demand auto-detect + Revert PR.
        .route(
            "/projects/{project_id}/issues/{issue_id}/culprits:auto",
            post(api::culprits::auto_detect),
        )
        // v2.1 — re-fingerprint admin tool. Dry-run by default;
        // `{apply: true, confirm: "yes"}` mutates. See
        // `server/src/api/admin/refingerprint.rs` for the protocol.
        .route(
            "/projects/{project_id}/issues/{issue_id}/re-fingerprint",
            post(api::admin::refingerprint::refingerprint_issue),
        )
        // v2.2 — `/explore` is the single query endpoint that backs
        // every dashboard "find-bug" view AND any LLM agent's direct
        // query. Whitelist of dim × measure × filter; no SQL passthrough.
        // See `server/src/api/admin/explore.rs` for supported shapes.
        .route(
            "/projects/{project_id}/explore",
            post(api::admin::explore::explore),
        )
        // v2.2 — cross-release issue lineage. For an issue at the
        // current release, returns other issues in the project with
        // the same error_type but a different last_release. Closes
        // the "did this bug come back?" loop that release-IN-
        // fingerprint policy opened. See `api/admin/related.rs`.
        .route(
            "/projects/{project_id}/issues/{issue_id}/related-across-releases",
            axum::routing::get(api::admin::related::related_across_releases),
        )
        // v2.3 — cross-project user lookup, org-scoped (dashboard
        // doesn't need to track identity-scope ids). Browser hashes
        // raw value via crypto.subtle and POSTs
        // { keyType, clientHash }; server resolves the org's default
        // scope, computes the salted fingerprint, returns per-project
        // hit aggregates. See `api/admin/identity_lookup.rs`.
        .route(
            "/orgs/{slug}/users/lookup",
            post(api::admin::identity_lookup::lookup),
        )
        // v2.3 — GDPR-aligned DSR erase. Same body shape as lookup
        // (keyType + clientHash); adds `dryRun: bool`. dryRun=true
        // returns the affected-event count without mutating;
        // dryRun=false (or absent) pseudonymises payload.user across
        // every matching event + drops identity_fingerprints rows.
        // Audit log entry per call.
        .route(
            "/orgs/{slug}/users/erase",
            post(api::admin::identity_erase::erase),
        )
        // v2.4 — operator-driven identity merge. POST writes one row
        // in identity_merges mapping alias → primary; subsequent
        // /users/lookup against the alias transparently returns the
        // primary's events (one-hop follow). /undo soft-undoes
        // (sets undone_at) so the merge stops affecting lookups
        // but the audit row survives forever.
        .route(
            "/orgs/{slug}/users/merge",
            post(api::admin::identity_merge::merge),
        )
        .route(
            "/orgs/{slug}/users/merge/undo",
            post(api::admin::identity_merge::undo_merge),
        )
        // v2.4 — find-user lens primary drill: Issue Detail panel
        // listing the top-N fingerprints touching this issue inside
        // the active window. One row per (fingerprint, key_type)
        // pair; each row links into the existing single-fingerprint
        // detail page.
        .route(
            "/projects/{project_id}/issues/{issue_id}/affected-users",
            axum::routing::get(api::admin::issue_affected_users::affected_users),
        )
        // v2.4 — Users page default view. Aggregates over the org's
        // default identity scope; returns kpi + top-affected fingerprints
        // + per-release / per-key_type breakdown.
        .route(
            "/orgs/{slug}/users/overview",
            axum::routing::get(api::admin::users_overview::overview),
        )
        // v2.4 — single-fingerprint drill-in. Validates the path
        // segment is 64-char lowercase hex; returns per-project hits,
        // hour timeline and top issues touched.
        .route(
            "/orgs/{slug}/users/{fingerprintHex}",
            axum::routing::get(api::admin::users_detail::detail),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/culprits/{culprit_id}/revert-pr",
            post(api::culprits::generate_revert_pr),
        )
        // v1.1 +S7 升级 — SDK polls this to discover its live-mode flag.
        // Routed in the ingestion router (token-gated, same as /v1/events).
        // v0.8.4 — cert-monitor watchlist + observations.
        .route(
            "/projects/{project_id}/cert-monitor/domains",
            get(api::cert_monitor::list_domains).post(api::cert_monitor::add_domain),
        )
        .route(
            "/projects/{project_id}/cert-monitor/domains/{watch_id}",
            axum::routing::delete(api::cert_monitor::delete_domain),
        )
        .route(
            "/projects/{project_id}/cert-monitor/observations",
            get(api::cert_monitor::list_observations),
        )
        .route(
            "/projects/{project_id}/traces/{trace_id}",
            get(api::traces::trace_detail),
        )
        .route(
            "/projects/{project_id}/issues:bulk",
            post(api::admin::bulk_patch_issues),
        )
        .route(
            "/projects/{project_id}/health",
            get(api::health::handle),
        )
        .route(
            "/projects/{project_id}/events/{event_id}/source",
            get(api::admin::frame_source),
        )
        .route(
            "/projects/{project_id}/sourcemap-status",
            get(api::admin::sourcemap_status),
        )
        // v1.4 W27 — per-release source coverage probe.
        .route(
            "/projects/{project_id}/releases/{release}/source-coverage",
            get(api::admin::source_coverage),
        )
        .route(
            "/events/{event_id}/attachments/{ref_id}",
            get(api::attachments::fetch),
        )
        // Phase 48 sub-A.2 — list every attachment row the server knows
        // about for an event. Dashboard reads this directly so a broken
        // `payload.attachments` echo path (Insight's original report)
        // doesn't hide the screenshot. Scoped under /projects/{project_id}
        // so the require_project_in_org middleware gates access AND the
        // SQL query can use the (project_id, event_id) index instead of
        // a full-partition scan.
        .route(
            "/projects/{project_id}/events/{event_id}/attachments",
            get(api::attachments::list_for_event),
        )
        // v1.0 A3 — Replay-tab read path. Parses the latest
        // replay-kind NDJSON attachment server-side and returns a
        // JSON frame array, so the dashboard scrubber doesn't need
        // an NDJSON parser on the client.
        .route(
            "/projects/{project_id}/events/{event_id}/replay-frames",
            get(api::attachments::replay_frames),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/activity",
            get(api::admin::list_issue_activity),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/comments",
            post(api::admin::create_issue_comment),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/comments/{comment_id}",
            axum::routing::delete(api::admin::delete_issue_comment),
        )
        // v1.2 W8 — per-issue watch toggle + status probe.
        .route(
            "/projects/{project_id}/issues/{issue_id}/watch",
            get(api::admin::watch_status)
                .put(api::admin::watch_issue)
                .delete(api::admin::unwatch_issue),
        )
        // v1.4 W18 — per-issue mute toggle.
        .route(
            "/projects/{project_id}/issues/{issue_id}/mute",
            axum::routing::put(api::admin::mute_issue)
                .delete(api::admin::unmute_issue),
        )
        // v1.2 W7.a — per-issue list of external integration links.
        .route(
            "/projects/{project_id}/issues/{issue_id}/integration-links",
            get(api::admin::list_integration_links),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}",
            get(api::admin::issue_detail).patch(api::admin::patch_issue),
        )
        // Phase 44 sub-C: manual fingerprint rewrite — merge one
        // issue's events into another.
        .route(
            "/projects/{project_id}/issues/{issue_id}/merge",
            post(api::admin::merge_issue),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/events",
            get(api::admin::list_events_for_issue),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/releases",
            get(api::admin::releases_for_issue),
        )
        // Phase 47.01: related-issues panel — sibling issues likely
        // to share root cause (same error_type, same project, capped
        // at 5).
        .route(
            "/projects/{project_id}/issues/{issue_id}/related",
            get(api::admin::related_issues),
        )
        // Phase 50 sub-A1: SSE feed of inbound event ticks for a
        // project. Dashboard's live sparkline subscribes here.
        .route(
            "/projects/{project_id}/events:stream",
            get(api::events_stream::handle),
        )
        // Analytics v1 chunk A — concurrent-user snapshot. Dashboard
        // polls every 5 s.
        .route(
            "/projects/{project_id}/live",
            get(api::live::handle),
        )
        // v1.1 chunk C — Audience metrics endpoint backing the
        // Audience > Metrics tab. On-the-fly aggregation over
        // track_events + events; ~50ms for a 7d range on the dev box.
        .route(
            "/projects/{project_id}/audience/metrics",
            get(api::audience_metrics::handle),
        )
        // v1.1 chunk D — Behavior + User detail.
        .route(
            "/projects/{project_id}/audience/top-routes",
            get(api::behavior::top_routes),
        )
        .route(
            "/projects/{project_id}/users/{user_id}/timeline",
            get(api::behavior::user_timeline),
        )
        // v1.1 chunk S2 — Pin anomaly list for the Security panel.
        .route(
            "/projects/{project_id}/security/pin-anomalies",
            get(api::security::list_pin_anomalies),
        )
        // v1.1 chunk S3 — Posture > Trust tab. Lowest-score installs
        // in the last 24h, with their signal mix.
        .route(
            "/projects/{project_id}/trust/scores",
            get(api::trust_score::list_low_scores),
        )
        .route(
            "/projects/{project_id}/dsyms",
            get(api::dsyms::list_dsyms).post(api::dsyms::upload_dsym).layer((
                DefaultBodyLimit::disable(),
                RequestBodyLimitLayer::new(MAX_ADMIN_UPLOAD_BYTES),
            )),
        )
        .route(
            "/projects/{project_id}/mappings",
            get(api::mappings::list_mappings).post(api::mappings::upload_mapping).layer((
                DefaultBodyLimit::disable(),
                RequestBodyLimitLayer::new(MAX_ADMIN_UPLOAD_BYTES),
            )),
        )
        .route(
            "/projects/{project_id}/source-bundles",
            axum::routing::post(api::source_bundle::upload_source_bundle).layer((
                DefaultBodyLimit::disable(),
                RequestBodyLimitLayer::new(MAX_ADMIN_UPLOAD_BYTES),
            )),
        )
        // v1.3 W15 — delete a release_artifacts row (used by the
        // source-bundle panel; works for any kind).
        .route(
            "/projects/{project_id}/releases/{release}/artifacts/{artifact_id}",
            axum::routing::delete(api::source_bundle::delete_release_artifact),
        )
        .route(
            "/projects/{project_id}/releases",
            get(api::releases::list_releases),
        )
        .route(
            "/projects/{project_id}/releases/{release}/artifacts",
            get(api::dsyms::release_artifacts),
        )
        .route(
            "/projects/{project_id}/releases/{base}/compare/{target}",
            get(api::releases::compare_releases),
        )
        .route(
            "/projects/{project_id}/recipients",
            get(api::recipients::list_recipients).post(api::recipients::create_recipient),
        )
        .route(
            "/projects/{project_id}/recipients/{recipient_id}",
            axum::routing::patch(api::recipients::patch_recipient)
                .delete(api::recipients::delete_recipient),
        )
        .route(
            "/releases/{release_name}/sourcemaps",
            post(api::releases::upload_sourcemaps).layer((
                DefaultBodyLimit::disable(),
                RequestBodyLimitLayer::new(MAX_ADMIN_UPLOAD_BYTES),
            )),
        )
        // route_layer is inside-out: require_admin runs first (sets the
        // AdminCaller extension), then require_project_in_org reads it
        // and scope-checks any /projects/{uuid}/... path.
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            api::admin_auth::require_project_in_org,
        ))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            api::admin_auth::require_admin,
        ));

    let admin_public = Router::new()
        .route("/login", post(api::admin_auth::login))
        .route("/logout", post(api::admin_auth::logout))
        .route("/me", get(api::admin_auth::me))
        // F4 self-test — platform health snapshot consumed by the
        // dashboard's Overview "platform health" strip. Public so
        // the strip renders before the operator logs in (they need
        // to know server is reachable to debug auth issues).
        .route("/self-test", get(api::self_test::handle));

    // v1.0 — operator god-mode endpoints. Cookie-session-authed and
    // gated by `users.is_superadmin = TRUE`. Mounted under
    // `/admin/api/superadmin/...` so the dashboard's existing
    // adminFetch helper picks them up.
    let superadmin_routes = Router::new()
        .route("/superadmin/users", get(api::superadmin::list_users))
        .route(
            "/superadmin/users/{user_id}",
            axum::routing::patch(api::superadmin::patch_user),
        )
        .route("/superadmin/orgs", get(api::superadmin::list_orgs))
        .route("/superadmin/projects", get(api::superadmin::list_projects))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            api::superadmin::require_superadmin,
        ));

    let admin = Router::new()
        .merge(admin_protected)
        .merge(admin_public)
        .merge(superadmin_routes);

    // Phase 13 sub-B: user auth (separate from admin_password-based admin auth).
    // register/login are rate-limited per-IP; verify/logout/me are open.
    let user_auth_limited = Router::new()
        .route("/register", post(api::user_auth::register))
        .route("/login", post(api::user_auth::login))
        // v1.0 — password reset is rate-limited too (one of the
        // classic email-bombing vectors).
        .route("/forgot-password", post(api::user_auth::forgot_password))
        .route("/reset-password", post(api::user_auth::reset_password))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            crate::rate_limit::rate_limit_auth_middleware,
        ));
    let user_auth_open = Router::new()
        .route("/verify", get(api::user_auth::verify))
        .route("/logout", post(api::user_auth::logout))
        .route("/me", get(api::user_auth::me))
        // v1.0 — dashboard polls this to decide which OAuth buttons
        // to render on /login + /register.
        .route("/oauth/providers", get(api::user_auth::oauth_providers))
        // v1.0 — OAuth authorization-code flow. Both endpoints are
        // unauth (a logged-out user is the entire point of /start).
        .route("/oauth/{provider}/start", get(api::oauth::start))
        .route("/oauth/{provider}/callback", get(api::oauth::callback));
    // v1.0 — authed-user-only profile + change-password mutations.
    // Sit behind the same require_user guard the orgs/teams routes use.
    let user_auth_authed = Router::new()
        .route("/me", axum::routing::patch(api::user_auth::patch_me))
        .route("/change-password", post(api::user_auth::change_password))
        .route(
            "/sign-out-everywhere",
            post(api::user_auth::sign_out_everywhere),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            api::user_auth::require_user,
        ));
    let user_auth = Router::new()
        .merge(user_auth_limited)
        .merge(user_auth_open)
        .merge(user_auth_authed);

    // Phase 13 sub-C: orgs / memberships / invites. All require_user.
    let orgs = Router::new()
        .route("/orgs", post(api::orgs::create_org).get(api::orgs::list_my_orgs))
        .route(
            "/orgs/{slug}",
            get(api::orgs::get_org)
                .patch(api::orgs::patch_org)
                .delete(api::orgs::delete_org),
        )
        .route("/orgs/{slug}/usage", get(api::orgs::org_usage))
        .route("/orgs/{slug}/export", get(api::orgs::export_org))
        // v1.1 chunk S4 — cross-project federation lookup. Returns
        // every project in the org that has a link for (provider,
        // subject); a single Google account that signed into 3 apps
        // surfaces as 3 rows here.
        .route(
            "/orgs/{slug}/federation/{provider}/{subject}",
            get(api::federation::lookup_by_subject),
        )
        .route("/orgs/{slug}/members", get(api::orgs::list_members))
        .route(
            "/orgs/{slug}/members/{user_id}",
            axum::routing::patch(api::orgs::patch_member).delete(api::orgs::delete_member),
        )
        .route(
            "/orgs/{slug}/teams",
            get(api::teams::list_teams).post(api::teams::create_team),
        )
        .route(
            "/orgs/{slug}/teams/{team_slug}",
            get(api::teams::get_team)
                .patch(api::teams::patch_team)
                .delete(api::teams::delete_team),
        )
        .route(
            "/orgs/{slug}/teams/{team_slug}/members",
            get(api::teams::list_team_members).post(api::teams::add_team_member),
        )
        .route(
            "/orgs/{slug}/teams/{team_slug}/members/{user_id}",
            axum::routing::patch(api::teams::patch_team_member)
                .delete(api::teams::remove_team_member),
        )
        .route(
            "/orgs/{slug}/teams/{team_slug}/projects",
            get(api::teams::list_team_projects),
        )
        .route(
            "/orgs/{slug}/invites",
            post(api::orgs::create_invite).get(api::orgs::list_invites),
        )
        .route(
            "/orgs/{slug}/invites/{token}",
            axum::routing::delete(api::orgs::delete_invite),
        )
        .route("/invites/{token}/accept", post(api::orgs::accept_invite))
        .route(
            "/orgs/{slug}/transfer",
            post(api::orgs::create_transfer),
        )
        .route(
            "/orgs/transfers/{token}/accept",
            post(api::orgs::accept_transfer),
        )
        .route("/orgs/{slug}/audit", get(api::orgs::list_audit))
        .route("/audit/actions", get(api::orgs::list_audit_actions))
        .route("/users/me/activity", get(api::orgs::list_my_activity))
        .route(
            "/users/me/digests",
            get(api::digests::list_my_digests).post(api::digests::subscribe),
        )
        .route(
            "/users/me/digests/{org_slug}/{frequency}",
            axum::routing::delete(api::digests::unsubscribe),
        )
        .route(
            "/orgs/{slug}/views",
            get(api::views::list_views).post(api::views::create_view),
        )
        .route(
            "/orgs/{slug}/views/{id}",
            axum::routing::delete(api::views::delete_view),
        )
        .route(
            "/orgs/{slug}/alert-rules",
            get(api::alert_rules::list_rules).post(api::alert_rules::create_rule),
        )
        .route(
            "/orgs/{slug}/alert-rules/{id}",
            axum::routing::patch(api::alert_rules::patch_rule)
                .delete(api::alert_rules::delete_rule),
        )
        .route(
            "/orgs/{slug}/alert-rules/{rule_id}/deliveries",
            get(api::alert_rules::list_deliveries),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            api::user_auth::require_user,
        ));

    let metrics = if let Some(handle) = cfg.metrics {
        Router::new().route(
            "/metrics",
            get(move || {
                let h = handle.clone();
                async move { h.render() }
            }),
        )
    } else {
        Router::new()
    };

    // Phase 43 sub-D.01: Linear / Slack incoming webhooks. No token
    // auth — Linear posts here directly + signs with HMAC-SHA-256
    // (verified per-adapter). Route lives outside the `require_token`
    // group; the body has to stay raw bytes for the signature check.
    let integrations_public = Router::new()
        .route(
            "/v1/integrations/linear/webhook",
            post(api::integrations::linear_webhook),
        )
        .route(
            "/v1/integrations/github/webhook",
            post(api::integrations::github_webhook),
        )
        .route(
            "/v1/integrations/gitlab/webhook",
            post(api::integrations::gitlab_webhook),
        )
        .route(
            "/v1/integrations/jira/webhook",
            post(api::integrations::jira_webhook),
        );

    // Dev-only token peek routes — gated by SENTORI_EXPOSE_DEV_TOKENS=1.
    // Playwright (and other e2e harnesses) use these to pluck a freshly
    // issued verification or password-reset token out of the database
    // without needing to shell into the postgres container. The env var
    // is unset in production.
    let dev_token_peek = if std::env::var("SENTORI_EXPOSE_DEV_TOKENS")
        .ok()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        Some(
            Router::new()
                .route(
                    "/last-verify-token",
                    get(api::user_auth::dev_last_verify_token),
                )
                .route(
                    "/last-reset-token",
                    get(api::user_auth::dev_last_reset_token),
                )
                .with_state(state.clone()),
        )
    } else {
        None
    };

    let mut app = Router::new()
        .merge(ingestion)
        .merge(integrations_public)
        .nest("/admin/api", admin)
        .nest("/api/auth", user_auth)
        .nest("/api", orgs)
        .merge(metrics);
    if let Some(r) = dev_token_peek {
        app = app.nest("/dev", r);
    }
    app
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        // Phase 37 sub-A: self-instrument span emission. Wrap last so
        // the wrapped future runs once per top-level request — inner
        // layers (auth, rate limit) execute inside the span's time
        // window and contribute to its duration.
        .layer({
            let emitter = cfg_self_trace_clone.clone();
            middleware::from_fn(move |req, next| {
                let emitter = emitter.clone();
                async move {
                    match emitter {
                        Some(e) => crate::tracing_middleware::tracing_middleware(e, req, next).await,
                        None => next.run(req).await,
                    }
                }
            })
        })
        .layer(
            CorsLayer::permissive()
                // Phase 33 sub-B: list_issues returns the next-page
                // cursor in this header; browsers won't expose it to
                // JS without this allow-list.
                // F1: also expose the correlation-id header so the
                // dashboard can surface it in error banners.
                .expose_headers([
                    http::HeaderName::from_static("x-next-cursor"),
                    http::HeaderName::from_static(crate::correlation_id::HEADER_NAME),
                ]),
        )
        .layer(TraceLayer::new_for_http())
        // F2 — convert plain-text / empty 4xx-5xx (tower-http body
        // limit, method-not-allowed, etc.) into the structured
        // `ErrorBodyV2` envelope. Runs INSIDE the correlation-id
        // layer so the task-local cid is already set.
        .layer(middleware::from_fn(
            crate::error_envelope::structured_error_responses,
        ))
        // F1 — correlation-id middleware. Wrap LAST so it executes
        // first on the request path (Tower layers are outside-in on
        // request, inside-out on response): mint id → inner layers
        // run → response → outer layer sets header.
        .layer(middleware::from_fn(crate::correlation_id::correlation_id_middleware))
        .with_state(state)
}
