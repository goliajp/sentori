//! HTTP handler aggregation.
//!
//! v0.1 essential routes only — full surface lives in
//! Phase 4 once the dashboard wiring lands. The skeleton
//! gives `docker compose up` a working server that
//! migrate-runs, bootstraps the owner, and exposes
//! enough surface for SDK ingest + healthcheck.

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};

use crate::state::AppState;

mod alerts;
mod audit;
mod cert;
mod events;
mod health;
mod ingest;
mod issues;
mod projects;
mod saved_views;
mod usage;

pub fn router(state: Arc<AppState>) -> Router {
    use axum::routing::{delete, patch};
    Router::new()
        .route("/healthz", get(health::healthz))
        // ── projects ────────────────────────────────────
        .route("/v1/projects", get(projects::list))
        .route("/v1/projects/:project_id/issues", get(issues::list))
        .route("/v1/projects/:project_id/events", get(events::list))
        .route("/v1/projects/:project_id/cert/watches", get(cert::list_watches))
        .route("/v1/projects/:project_id/cert/observations", get(cert::list_observations))
        .route(
            "/v1/projects/:project_id/alerts",
            get(alerts::list_for_project),
        )
        // ── workspace-wide ──────────────────────────────
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
        // ── ingest ──────────────────────────────────────
        .route("/v1/events/:project_id", post(ingest::ingest_event))
        // legacy-compat — see docs-v0.1/reference/api-compat.md
        .route("/v1/events", post(ingest::ingest_event_legacy))
        .with_state(state)
}
