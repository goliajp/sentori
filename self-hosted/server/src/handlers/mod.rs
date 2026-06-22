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

use crate::saasadmin_mw::saasadmin_only;
use crate::session_mw::session_middleware;
use crate::state::AppState;

mod admin;
mod alerts;
mod audit;
mod auth;
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

    // Admin routes — session-gated (cookie or Bearer session_token).
    let admin_routes = Router::new()
        .route(
            "/admin/api/projects/:project_id/tokens",
            get(admin::tokens::list).post(admin::tokens::create),
        )
        .route(
            "/admin/api/tokens/:token_id",
            delete(admin::tokens::revoke),
        )
        .route("/admin/api/projects", post(admin::projects::create))
        .route(
            "/admin/api/projects/:project_id",
            get(admin::projects::get)
                .patch(admin::projects::update)
                .delete(admin::projects::delete),
        )
        .route(
            "/admin/api/projects/:project_id/push/credentials",
            get(admin::push_credentials::list)
                .post(admin::push_credentials::upsert),
        )
        .route(
            "/admin/api/projects/:project_id/push/credentials/:kind",
            delete(admin::push_credentials::delete),
        )
        .route("/admin/api/members", get(admin::members::list))
        .route(
            "/admin/api/members/:user_id",
            patch(admin::members::update_role).delete(admin::members::remove),
        )
        .route(
            "/admin/api/invites",
            get(admin::invites::list).post(admin::invites::create),
        )
        .route("/admin/api/invites/:id", delete(admin::invites::revoke))
        .route(
            "/admin/api/projects/:project_id/cert/watches",
            post(admin::cert_watch::add),
        )
        .route(
            "/admin/api/projects/:project_id/cert/watches/:domain",
            delete(admin::cert_watch::remove),
        )
        .route(
            "/admin/api/projects/:project_id/integrations",
            get(admin::integrations::list).post(admin::integrations::upsert),
        )
        .route(
            "/admin/api/projects/:project_id/integrations/:kind",
            delete(admin::integrations::delete),
        )
        .route(
            "/admin/api/projects/:project_id/integrations/:kind/active",
            patch(admin::integrations::set_active),
        )
        // ── admin: releases ───────────────────────────────
        .route(
            "/admin/api/projects/:project_id/releases",
            get(admin::releases::list),
        )
        .route(
            "/admin/api/projects/:project_id/releases/:release_id/artifacts",
            get(admin::releases::list_artifacts),
        )
        .route(
            "/admin/api/releases/:release_id",
            delete(admin::releases::delete),
        )
        // Session-scoped self endpoints
        .route("/auth/me", get(auth::me))
        .route("/auth/logout", post(auth::logout))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            session_middleware,
        ))
        .with_state(state.clone());

    // SaaS cross-workspace endpoints — session-gated AND
    // saasadmin-role-gated (env-driven allowlist).
    let saas_routes = Router::new()
        .route("/admin/api/saas/workspaces", get(admin::saas::workspaces))
        .route("/admin/api/saas/stats", get(admin::saas::workspace_stats))
        .layer(axum_middleware::from_fn(saasadmin_only))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            session_middleware,
        ))
        .with_state(state.clone());

    // Dashboard / public routes (open in v0.2; can be locked
    // behind the same session middleware via env-var flip).
    Router::new()
        .route("/healthz", get(health::healthz))
        .route("/v1/projects", get(projects::list))
        .route("/v1/projects/:project_id/issues", get(issues::list))
        .route(
            "/v1/projects/:project_id/issues/:issue_id",
            get(issues::get).patch(issues::patch),
        )
        .route("/v1/projects/:project_id/events", get(events::list))
        .route("/v1/projects/:project_id/events/trend", get(events::trend))
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
            get(alerts::get).patch(alerts::update).delete(alerts::delete),
        )
        .route(
            "/v1/saved-views",
            get(saved_views::list_workspace).post(saved_views::create),
        )
        .route(
            "/v1/saved-views/:id",
            get(saved_views::get)
                .patch(saved_views::patch)
                .delete(saved_views::delete),
        )
        // legacy fresh-start ingest stubs (defer to SDK-auth path)
        .route("/v1/projects/:project_id/ingest", post(ingest::ingest_event))
        // ── auth: dashboard user lifecycle (public) ──────
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/verify", post(auth::verify))
        .route("/auth/forgot-password", post(auth::forgot))
        .route("/auth/reset-password", post(auth::reset))
        .route("/auth/change-password", post(auth::change_password))
        .with_state(state)
        .merge(admin_routes)
        .merge(saas_routes)
        .merge(sdk_routes)
        .fallback_service(webapp_service())
}

/// Static-file service for the bundled webapp. Resolves to the
/// path in `SENTORI_WEBAPP_DIST` env-var, defaulting to
/// `/app/webapp` inside the container.
///
/// Returns 404 on missing files (axum's default ServeDir
/// behavior) — that's fine because API routes are matched
/// first; only true SPA paths hit the fallback. SPA-style
/// path fall-through (`/projects/abc/issues` → `index.html`)
/// is handled by `not_found_service`.
fn webapp_service() -> axum::routing::MethodRouter {
    use tower_http::services::{ServeDir, ServeFile};
    let root = std::env::var("SENTORI_WEBAPP_DIST")
        .unwrap_or_else(|_| "/app/webapp".to_string());
    let index = format!("{root}/index.html");
    axum::routing::get_service(
        ServeDir::new(&root).not_found_service(ServeFile::new(index)),
    )
}
