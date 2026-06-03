// Admin / dashboard read + write API.
//
// v1.1 P2: split out of the 1265-LOC `api/admin.rs`. Logical groups:
//   - mod.rs (this file): top-level project list, shared types,
//     shared helpers, sub-mod decls + re-exports.
//   - issues.rs: issue list / detail / related / releases / patch.
//   - issue_actions.rs: merge_issue + bulk_patch_issues.
//   - frame_source.rs: source preview for a stack frame.
//   - activity.rs: per-issue activity feed + comments.
//   - events.rs: per-issue event list (with symbolicate + attachment
//     enrichment).
//
// Pub surface preserved via `pub use` so the router and external
// callers continue to use `api::admin::list_issues`, etc.

use axum::{
    extract::{Extension, Json, State},
    response::Response,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

// ── projects ────────────────────────────────────────────────────────────

/// Phase 13 sub-D: list projects visible to the caller.
/// - User session  → projects in any of the user's orgs.
/// - LegacyAdmin / DevToken → all projects (super-admin).
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub id: Uuid,
    pub name: String,
    pub org_id: Uuid,
    pub org_slug: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// Phase 42 sub-A.11: optional repo root URL.
    pub source_repo_url: Option<String>,
}

pub async fn list_my_projects(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<Vec<ProjectRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    let rows: Vec<ProjectRow> = match caller {
        AdminCaller::User { id, .. } => sqlx::query_as(
            "SELECT p.id, p.name, p.org_id, o.slug AS org_slug, p.created_at, \
                    p.source_repo_url \
             FROM projects p \
             JOIN orgs o ON o.id = p.org_id \
             JOIN memberships m ON m.org_id = p.org_id \
             WHERE m.user_id = $1 \
             ORDER BY p.created_at DESC",
        )
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list_my_projects: {e}")))?,
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => sqlx::query_as(
            "SELECT p.id, p.name, p.org_id, o.slug AS org_slug, p.created_at, \
                    p.source_repo_url \
             FROM projects p \
             JOIN orgs o ON o.id = p.org_id \
             ORDER BY p.created_at DESC",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(format!("list_my_projects: {e}")))?,
    };

    Ok(Json(rows))
}

// ── shared event row + query shape used by issues + events ─────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub received_at: OffsetDateTime,
    pub platform: String,
    pub release: String,
    pub environment: String,
    pub error_type: String,
    pub error_message: String,
    pub payload: serde_json::Value,
    pub trace_id: Option<Uuid>,
    pub span_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEventsQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    /// Default true. `?symbolicated=false` returns raw frames.
    #[serde(default)]
    pub symbolicated: Option<bool>,
    /// Lookback window in days. Defaults to 90.
    #[serde(default)]
    pub days: Option<i64>,
    /// v2.1 cursor — RFC-3339 timestamp; rows with `received_at <
    /// before` are returned, ordered DESC, capped at `limit`. Used
    /// by the dashboard's "Load older" button to walk past the
    /// initial 500-row page without a heavier cursor protocol.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub before: Option<OffsetDateTime>,
}

// ── shared helpers used across sub-modules ──────────────────────────────

pub(super) fn default_status() -> String {
    "active".to_string()
}

/// Cursor format: `<rfc3339-last-seen>|<uuid>`.
pub(super) fn encode_cursor(last_seen: OffsetDateTime, id: Uuid) -> String {
    format!(
        "{}|{}",
        last_seen
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        id
    )
}

pub(super) fn parse_cursor(s: &str) -> Option<(OffsetDateTime, Uuid)> {
    let (ts, id) = s.split_once('|')?;
    let last_seen = OffsetDateTime::parse(ts, &time::format_description::well_known::Rfc3339).ok()?;
    let id = Uuid::parse_str(id).ok()?;
    Some((last_seen, id))
}

/// Distinguish "field not present" from "field present with null".
pub(super) fn deserialize_double_option<'de, T, D>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

pub(super) const ALLOWED_STATUSES: &[&str] = &[
    "active",
    "silenced",
    "closed",
    "resolved",
    // v1.2 W6: muted = "soft silence; stays in active queue, no alerts".
    "muted",
];
pub(super) const BULK_LIMIT: usize = 200;
pub(super) const COMMENT_BODY_MIN: usize = 1;
pub(super) const COMMENT_BODY_MAX: usize = 2000;
pub(super) const FRAME_SOURCE_CONTEXT_LINES_DEFAULT: usize = 5;
pub(super) const FRAME_SOURCE_CONTEXT_LINES_MAX: usize = 50;
pub(super) const CAUSE_CHAIN_MAX: usize = 10;

// Suppress unused-warning when sub-modules don't use `Response` (rare).
#[allow(dead_code)]
type _UnusedResponse = Response;

// ── sub-modules + re-exports ────────────────────────────────────────────

mod activity;
mod events;
pub mod explore;
mod frame_source;
pub mod identity_erase;
pub mod identity_lookup;
pub mod users_detail;
pub mod users_overview;
mod integration_links;
mod integration_templates;
mod issue_actions;
mod issues;
mod labels;
mod notifications;
pub mod refingerprint;
pub mod related;
mod sourcemap_status;
mod webhook_deliveries;

pub use activity::{
    create_issue_comment, delete_issue_comment, list_issue_activity, ActivityEntry,
    CreateCommentRequest, CreateCommentResponse,
};
pub use events::list_events_for_issue;
pub use frame_source::{frame_source, FrameSourceQuery, FrameSourceResponse};
pub use integration_links::{list_integration_links, IntegrationLinkRow};
pub use integration_templates::{
    apply_template, create_template, delete_template, list_templates, update_template,
    IntegrationTemplateRow,
};
pub use labels::{create_label, delete_label, list_labels, update_label, OrgLabelRow};
pub use notifications::{
    get_preferences as get_notification_preferences, list_notifications, mark_all_read, mark_read,
    mute_issue, put_preferences as put_notification_preferences, run_digest_now, send_test_email,
    stream as notification_stream, unmute_issue, unwatch_issue, watch_issue, watch_status,
    NotificationPreferences, NotificationRow, RunDigestResponse, TestEmailResponse,
};
pub use sourcemap_status::{
    source_coverage, sourcemap_status, SourceCoverageResponse, SourcemapStatusResponse,
};
pub use webhook_deliveries::{
    list_deliveries as list_webhook_deliveries, retry_delivery as retry_webhook_delivery,
    WebhookDeliveryRow,
};
pub use issue_actions::{
    bulk_patch_issues, merge_issue, BulkPatchRequest, BulkPatchResponse, MergeIssueBody,
    MergeIssueResponse,
};
pub use issues::{
    issue_detail, list_issues, patch_issue, related_issues, releases_for_issue, IssueRow,
    ListIssuesQuery, PatchIssueRequest, RelatedIssueRow,
};
