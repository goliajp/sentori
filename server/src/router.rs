use axum::{
    Router,
    extract::DefaultBodyLimit,
    http,
    middleware,
    routing::{get, post},
};
use metrics_exporter_prometheus::PrometheusHandle;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;

use crate::api;
use crate::auth::{AuthState, require_token};
use crate::recent::{AppState, RecentBuffer};

const MAX_BODY_BYTES: usize = 1024 * 1024; // 1 MB per protocol.md size limits
// Phase 22 sub-A: dSYM uploads can run up to ~256 MB per arch slice;
// release / sourcemap / dsym admin routes opt out of the 1 MB cap
// via DefaultBodyLimit::disable() and rely on per-handler validation.
const MAX_ADMIN_UPLOAD_BYTES: usize = 256 * 1024 * 1024;

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
}

pub fn build(cfg: ServerConfig) -> Router {
    let auth_state = AuthState::new(cfg.dev_token, cfg.db.clone());
    let recent = RecentBuffer::new();
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
    };

    let ingestion = Router::new()
        .route("/v1/events", post(api::events::handle))
        .route("/v1/events:batch", post(api::events_batch::handle))
        .route("/v1/events/_recent", get(api::recent::handle))
        .route("/v1/deploys", post(api::deploys::handle))
        .route("/v1/sessions", post(api::sessions::handle))
        .route("/v1/spans", post(api::spans::handle))
        .route("/v1/spans:batch", post(api::spans::handle_batch))
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
        .route(
            "/projects/{project_id}/issues",
            get(api::admin::list_issues),
        )
        .route(
            "/projects/{project_id}/traces",
            get(api::traces::list_traces),
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
        .route(
            "/projects/{project_id}/issues/{issue_id}",
            get(api::admin::issue_detail).patch(api::admin::patch_issue),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/events",
            get(api::admin::list_events_for_issue),
        )
        .route(
            "/projects/{project_id}/issues/{issue_id}/releases",
            get(api::admin::releases_for_issue),
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
        .route("/me", get(api::admin_auth::me));

    let admin = Router::new().merge(admin_protected).merge(admin_public);

    // Phase 13 sub-B: user auth (separate from admin_password-based admin auth).
    // register/login are rate-limited per-IP; verify/logout/me are open.
    let user_auth_limited = Router::new()
        .route("/register", post(api::user_auth::register))
        .route("/login", post(api::user_auth::login))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            crate::rate_limit::rate_limit_auth_middleware,
        ));
    let user_auth_open = Router::new()
        .route("/verify", get(api::user_auth::verify))
        .route("/logout", post(api::user_auth::logout))
        .route("/me", get(api::user_auth::me));
    let user_auth = Router::new().merge(user_auth_limited).merge(user_auth_open);

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

    Router::new()
        .merge(ingestion)
        .nest("/admin/api", admin)
        .nest("/api/auth", user_auth)
        .nest("/api", orgs)
        .merge(metrics)
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(
            CorsLayer::permissive()
                // Phase 33 sub-B: list_issues returns the next-page
                // cursor in this header; browsers won't expose it to
                // JS without this allow-list.
                .expose_headers([http::HeaderName::from_static("x-next-cursor")]),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
