//! HTTP handler aggregation.
//!
//! Two route groups:
//! - **SDK ingest** (`/v1/*`): Bearer st_pk_<token> authenticated
//!   via `sentori-ingest-token`'s `bearer_middleware`. Each handler
//!   receives `Extension<IngestContext>` with the resolved
//!   `(workspace_id, project_id, token_kind)`.
//! - **Dashboard / admin** (`/healthz`, `/v1/projects/...`,
//!   `/v1/usage`, ...): unauthenticated for v0.2 step 2; Phase E
//!   will gate with cookie session.

use std::sync::Arc;

use axum::Router;
use axum::middleware as axum_middleware;
use axum::routing::{delete, get, patch, post};
use sentori_ingest_token::{TokenStore, bearer_middleware};

use crate::state::AppState;

mod admin;
mod alerts;
mod audit;
mod cert;
mod events;
mod health;
mod ingest;
mod issues;
mod projects;
mod saved_views;
mod sdk;
mod usage;

pub fn router(state: Arc<AppState>) -> Router {
    // SDK ingest routes — Bearer st_pk_ gated.
    let token_store = TokenStore::new(state.pool.clone());
    let sdk_routes = Router::new()
        // ── events ──
        .route("/v1/events", post(sdk::events::handle))
        .route("/v1/events:batch", post(sdk::events_batch::handle))
        .route(
            "/v1/events/:event_id/attachments/:kind",
            post(sdk::events_attachments::handle),
        )
        .route("/v1/events/_recent", get(sdk::events_recent::handle))
        // ── tracing ──
        .route("/v1/spans", post(sdk::spans::handle))
        .route("/v1/spans:batch", post(sdk::spans_batch::handle))
        // ── lifecycle ──
        .route("/v1/heartbeat", post(sdk::heartbeat::handle))
        .route("/v1/sessions", post(sdk::sessions::handle))
        .route("/v1/deploys", post(sdk::deploys::handle))
        // ── metrics ──
        .route("/v1/metrics:batch", post(sdk::metrics::handle))
        .route("/v1/runtime-metrics:batch", post(sdk::runtime_metrics::handle))
        // ── analytics ──
        .route("/v1/track:batch", post(sdk::track::handle))
        // ── security ──
        .route("/v1/security:report", post(sdk::security_report::handle))
        .route("/v1/security/link", post(sdk::security_link::handle))
        .route("/v1/security/score", get(sdk::security_score::handle))
        // ── control ──
        .route("/v1/control/poll", get(sdk::control::handle))
        // ── feedback ──
        .route("/v1/user-reports", post(sdk::user_reports::handle))
        // ── push (11 endpoints) ──
        .route("/v1/push/tokens", post(sdk::push::register_token::handle))
        .route(
            "/v1/push/tokens/:handle",
            delete(sdk::push::revoke_token::handle),
        )
        .route(
            "/v1/push/tokens/:handle/topics",
            post(sdk::push::subscribe_topic::handle),
        )
        .route(
            "/v1/push/tokens/:handle/topics/:topic",
            delete(sdk::push::unsubscribe_topic::handle),
        )
        .route("/v1/push/send", post(sdk::push::send::handle))
        .route(
            "/v1/push/receipts/:send_id",
            get(sdk::push::receipt::handle),
        )
        .route(
            "/v1/push/sends/:send_id/ack",
            post(sdk::push::ack::handle),
        )
        .route(
            "/v1/push/expo-compat/send",
            post(sdk::push::expo_send::handle),
        )
        .route(
            "/v1/push/expo-compat/receipts/:send_id",
            get(sdk::push::expo_receipt::handle),
        )
        .route(
            "/v1/push/users/:fp_hex/preferences",
            get(sdk::push::get_preferences::handle),
        )
        .route(
            "/v1/push/users/:fp_hex/preferences/:category",
            axum::routing::put(sdk::push::put_preference::handle),
        )
        .layer(axum_middleware::from_fn_with_state(
            token_store,
            bearer_middleware,
        ))
        .with_state(state.clone());

    // Dashboard / admin routes — Phase E will add cookie session
    // auth. For now they share AppState.
    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/v1/projects", get(projects::list))
        .route("/v1/projects/:project_id/issues", get(issues::list))
        .route("/v1/projects/:project_id/events", get(events::list))
        .route("/v1/projects/:project_id/cert/watches", get(cert::list_watches))
        .route(
            "/v1/projects/:project_id/cert/observations",
            get(cert::list_observations),
        )
        .route(
            "/v1/projects/:project_id/alerts",
            get(alerts::list_for_project),
        )
        .route("/v1/usage", get(usage::current))
        .route("/v1/audit", get(audit::list))
        .route("/v1/alerts", get(alerts::list_workspace).post(alerts::create))
        .route(
            "/v1/alerts/:id",
            patch(alerts::update).delete(alerts::delete),
        )
        .route(
            "/v1/saved-views",
            get(saved_views::list_workspace).post(saved_views::create),
        )
        .route("/v1/saved-views/:id", delete(saved_views::delete))
        // legacy fresh-start ingest stubs (defer to SDK-auth path)
        .route("/v1/projects/:project_id/ingest", post(ingest::ingest_event))
        // ── admin: tokens (new-customer onboarding) ──────
        .route(
            "/admin/api/projects/:project_id/tokens",
            get(admin::tokens::list).post(admin::tokens::create),
        )
        .route(
            "/admin/api/tokens/:token_id",
            delete(admin::tokens::revoke),
        )
        // ── admin: projects CRUD ──────────────────────────
        .route("/admin/api/projects", post(admin::projects::create))
        .route(
            "/admin/api/projects/:project_id",
            get(admin::projects::get)
                .patch(admin::projects::update)
                .delete(admin::projects::delete),
        )
        // ── admin: push credentials ───────────────────────
        .route(
            "/admin/api/projects/:project_id/push/credentials",
            get(admin::push_credentials::list)
                .post(admin::push_credentials::upsert),
        )
        .route(
            "/admin/api/projects/:project_id/push/credentials/:kind",
            delete(admin::push_credentials::delete),
        )
        // ── admin: members ────────────────────────────────
        .route("/admin/api/members", get(admin::members::list))
        .route(
            "/admin/api/members/:user_id",
            patch(admin::members::update_role).delete(admin::members::remove),
        )
        // ── admin: invites ────────────────────────────────
        .route(
            "/admin/api/invites",
            get(admin::invites::list).post(admin::invites::create),
        )
        .route(
            "/admin/api/invites/:id",
            delete(admin::invites::revoke),
        )
        // ── admin: cert watch domains ────────────────────
        .route(
            "/admin/api/projects/:project_id/cert/watches",
            post(admin::cert_watch::add),
        )
        .route(
            "/admin/api/projects/:project_id/cert/watches/:domain",
            delete(admin::cert_watch::remove),
        )
        .with_state(state)
        .merge(sdk_routes)
}
