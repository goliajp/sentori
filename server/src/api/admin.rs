use axum::{
    extract::{Extension, Json, Path, Query, State},
    http::{self, HeaderValue},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

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
    /// Phase 42 sub-A.11: optional repo root URL (e.g.
    /// `https://github.com/goliajp/sentori`). Used by the dashboard's
    /// per-frame "open on GitHub" link.
    pub source_repo_url: Option<String>,
}

pub async fn list_my_projects(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<Vec<ProjectRow>>, AppError> {
    let pool = state.db.as_ref().ok_or_else(|| AppError::DatabaseUnavailable)?;

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

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IssueRow {
    pub id: Uuid,
    pub fingerprint: String,
    pub error_type: String,
    pub message_sample: String,
    pub status: String,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
    pub event_count: i64,
    pub last_environment: Option<String>,
    pub last_release: Option<String>,
    // Phase 23 sub-D: regression bookkeeping. All four are NULL until a
    // resolve / regression has happened.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub resolved_at: Option<OffsetDateTime>,
    pub resolved_in_release: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub regressed_at: Option<OffsetDateTime>,
    pub regressed_in_release: Option<String>,
    // Phase 25 sub-F: assignee. NULL when nobody owns this issue.
    pub assignee_user_id: Option<Uuid>,
    pub assignee_email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIssuesQuery {
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub limit: Option<i64>,
    /// Filter on `issues.last_environment` (denormalized from latest event).
    #[serde(default)]
    pub env: Option<String>,
    /// Filter on `issues.last_release` (denormalized from latest event).
    #[serde(default)]
    pub release: Option<String>,
    /// Phase 24 sub-A: filter on `issues.error_type` (exact match).
    #[serde(default)]
    pub error_type: Option<String>,
    /// Phase 24 sub-A: only return rows whose `last_seen >= this`. Sent
    /// by the dashboard after parsing `last:24h` / `last:7d` style query
    /// tokens — RFC 3339 string parsed by serde via `OffsetDateTime`.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub last_seen_after: Option<time::OffsetDateTime>,
    /// Phase 33 sub-B: keyset pagination cursor. Format
    /// `<rfc3339-last-seen>|<uuid>`. The dashboard reads
    /// `X-Next-Cursor` off the previous page's response and feeds
    /// it back here to fetch the next slice. Falls back to OFFSET-0
    /// when unset.
    #[serde(default)]
    pub cursor: Option<String>,
}

fn default_status() -> String {
    "active".to_string()
}

pub async fn list_issues(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListIssuesQuery>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);

    // `status="any"` (or empty) skips the filter — used by the
    // dashboard's onboarding-pending check, which needs "has this
    // project ever received an event?" and shouldn't disappear once
    // the only issue is resolved.
    let status_filter: Option<&str> = match q.status.as_str() {
        "" | "any" => None,
        s => Some(s),
    };

    // Decode cursor (last_seen, id). Unset → unbounded; bad format
    // → ignored (forward-compat with future cursor schemes).
    let cursor: Option<(OffsetDateTime, Uuid)> = q.cursor.as_deref().and_then(parse_cursor);

    let rows: Vec<IssueRow> = sqlx::query_as(
        r#"
        SELECT i.id, i.fingerprint, i.error_type, i.message_sample, i.status,
               i.first_seen, i.last_seen, i.event_count,
               i.last_environment, i.last_release,
               i.resolved_at, i.resolved_in_release,
               i.regressed_at, i.regressed_in_release,
               i.assignee_user_id,
               u.email AS assignee_email
        FROM issues i
        LEFT JOIN users u ON u.id = i.assignee_user_id
        WHERE i.project_id = $1
          AND ($2::TEXT IS NULL OR i.status = $2)
          AND ($3::TEXT IS NULL OR i.last_environment = $3)
          AND ($4::TEXT IS NULL OR i.last_release = $4)
          AND ($5::TEXT IS NULL OR i.error_type = $5)
          AND ($6::TIMESTAMPTZ IS NULL OR i.last_seen >= $6)
          AND (
            $7::TIMESTAMPTZ IS NULL
            OR i.last_seen < $7::TIMESTAMPTZ
            OR (i.last_seen = $7::TIMESTAMPTZ AND i.id < $8::UUID)
          )
        ORDER BY i.last_seen DESC, i.id DESC
        LIMIT $9
        "#,
    )
    .bind(project_id)
    .bind(status_filter)
    .bind(q.env.as_deref())
    .bind(q.release.as_deref())
    .bind(q.error_type.as_deref())
    .bind(q.last_seen_after)
    .bind(cursor.map(|c| c.0))
    .bind(cursor.map(|c| c.1))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Build the response. If the page is exactly `limit` long there
    // *might* be more; emit `X-Next-Cursor` from the last row so the
    // client can keyset-paginate. Shorter than limit → caller has seen
    // everything, no cursor.
    let mut response = Json(&rows).into_response();
    if rows.len() as i64 == limit {
        if let Some(last) = rows.last() {
            let cursor_value = encode_cursor(last.last_seen, last.id);
            if let Ok(header) = HeaderValue::from_str(&cursor_value) {
                response.headers_mut().insert("X-Next-Cursor", header);
            }
        }
    }
    Ok(response)
}

/// Cursor format: `<rfc3339-last-seen>|<uuid>`. RFC 3339 contains
/// `:` so we use `|` as the separator. URL-safe without encoding
/// because `|` is in the unreserved set per RFC 3986 when sent as a
/// query value, and the header value rejects bad characters anyway.
fn encode_cursor(last_seen: OffsetDateTime, id: Uuid) -> String {
    format!(
        "{}|{}",
        last_seen
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
        id
    )
}

fn parse_cursor(s: &str) -> Option<(OffsetDateTime, Uuid)> {
    let (ts, id) = s.split_once('|')?;
    let last_seen = OffsetDateTime::parse(ts, &time::format_description::well_known::Rfc3339).ok()?;
    let id = Uuid::parse_str(id).ok()?;
    Some((last_seen, id))
}

/// `GET /admin/api/projects/{project_id}/issues/{issue_id}/releases`
/// Distinct release names this issue has been seen on, sorted ascending.
pub async fn releases_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<String>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let rows: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT release
        FROM events
        WHERE project_id = $1 AND issue_id = $2
        ORDER BY release
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(rows))
}

pub async fn issue_detail(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<IssueRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    let row: Option<IssueRow> = sqlx::query_as(
        r#"
        SELECT i.id, i.fingerprint, i.error_type, i.message_sample, i.status,
               i.first_seen, i.last_seen, i.event_count,
               i.last_environment, i.last_release,
               i.resolved_at, i.resolved_in_release,
               i.regressed_at, i.regressed_in_release,
               i.assignee_user_id,
               u.email AS assignee_email
        FROM issues i
        LEFT JOIN users u ON u.id = i.assignee_user_id
        WHERE i.project_id = $1 AND i.id = $2
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    row.map(Json).ok_or(AppError::NotFound)
}

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
    /// Phase 36 sub-C: link to the surrounding trace, if any. Set when
    /// the event was captured inside an active span.
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
    /// Lookback window in days. Defaults to 90. Bounded server-side so the
    /// planner can statically prune events partitions older than the bound.
    #[serde(default)]
    pub days: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PatchIssueRequest {
    pub status: Option<String>,
    /// Phase 25 sub-F. Use `Some(Some(uuid))` to assign, `Some(None)`
    /// to unassign, `None` (omitted) to leave alone. Serde double-
    /// option lets the dashboard send `assigneeUserId: null` distinctly
    /// from omitting the field.
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub assignee_user_id: Option<Option<Uuid>>,
    /// Phase 25 sub-F. When the caller is moving the issue to
    /// `resolved`, override `resolved_in_release` with this string
    /// instead of taking `last_release`. Same double-option semantics.
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub resolved_in_release: Option<Option<String>>,
}

impl Default for PatchIssueRequest {
    fn default() -> Self {
        Self {
            assignee_user_id: None,
            resolved_in_release: None,
            status: None,
        }
    }
}

/// Distinguish "field not present" from "field present with null". The
/// inner `Option<T>` carries the value (None = explicit null), the
/// outer `Option<...>` says whether the field was sent at all.
fn deserialize_double_option<'de, T, D>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

// `regressed` is intentionally NOT in the allow-list — that state is
// produced only by the ingest path catching a `resolved` issue with a
// fresh event. Patching to `resolved` clears any stale `regressed_at`
// markers so the timeline reads correctly on the next regression.
const ALLOWED_STATUSES: &[&str] = &["active", "silenced", "closed", "resolved"];

pub async fn patch_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PatchIssueRequest>,
) -> Result<Json<IssueRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    if let Some(status) = &body.status {
        if !ALLOWED_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Internal(format!(
                "invalid status '{status}'; allowed: {ALLOWED_STATUSES:?}"
            )));
        }
        // Phase 25 sub-F: caller may pin the resolve to a specific
        // release with `resolvedInRelease`. If unspecified, fall back
        // to last_release as before. The override only applies when
        // we're actually moving to `resolved`.
        let release_override = body
            .resolved_in_release
            .as_ref()
            .and_then(|o| o.as_ref().cloned());
        sqlx::query(
            r#"
            UPDATE issues SET
                status = $1,
                resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END,
                resolved_in_release = CASE
                    WHEN $1 = 'resolved' THEN COALESCE($4::TEXT, last_release)
                    ELSE NULL
                END,
                regressed_at = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_at END,
                regressed_in_release = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_in_release END
            WHERE project_id = $2 AND id = $3
            "#,
        )
        .bind(status)
        .bind(project_id)
        .bind(issue_id)
        .bind(release_override.as_deref())
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // Phase 25 sub-F: assignee patch is independent of status.
    // `Some(None)` clears, `Some(Some(uuid))` sets, `None` leaves alone.
    if let Some(opt) = &body.assignee_user_id {
        sqlx::query("UPDATE issues SET assignee_user_id = $1 WHERE project_id = $2 AND id = $3")
            .bind(opt.as_ref())
            .bind(project_id)
            .bind(issue_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    let row: Option<IssueRow> = sqlx::query_as(
        r#"
        SELECT i.id, i.fingerprint, i.error_type, i.message_sample, i.status,
               i.first_seen, i.last_seen, i.event_count,
               i.last_environment, i.last_release,
               i.resolved_at, i.resolved_in_release,
               i.regressed_at, i.regressed_in_release,
               i.assignee_user_id,
               u.email AS assignee_email
        FROM issues i
        LEFT JOIN users u ON u.id = i.assignee_user_id
        WHERE i.project_id = $1 AND i.id = $2
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    row.map(Json).ok_or(AppError::NotFound)
}

// Phase 24 sub-D: bulk action on multiple issues at once. Mirrors the
// single-row CASE bookkeeping (resolved_at + resolved_in_release stamp /
// clear; regressed_* clear when leaving resolved) so a multi-select
// resolve produces the same downstream regression behaviour.
//
// Capped at BULK_LIMIT to keep the UPDATE bounded — the dashboard sends
// the visible page (≤100), so 200 leaves headroom for "Select all
// across pages" if we ever add it.

const BULK_LIMIT: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BulkPatchRequest {
    pub issue_ids: Vec<Uuid>,
    /// One of `resolve` / `silence` / `close` / `reopen` / `assign`.
    /// Map to the corresponding `status` value server-side rather than
    /// letting the client pick the raw status — keeps the action
    /// vocabulary fixed and rejects e.g. a hand-crafted bulk-`regressed`
    /// request.
    pub action: String,
    /// Phase 25 sub-F: only meaningful when `action == "assign"`.
    /// Send a uuid to assign N issues to a user; send `null` (explicit)
    /// to bulk-unassign.
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub assignee_user_id: Option<Option<Uuid>>,
}

impl Default for BulkPatchRequest {
    fn default() -> Self {
        Self {
            action: String::new(),
            assignee_user_id: None,
            issue_ids: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkPatchResponse {
    pub updated: u64,
}

pub async fn bulk_patch_issues(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<BulkPatchRequest>,
) -> Result<Json<BulkPatchResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    if body.issue_ids.is_empty() {
        return Err(AppError::Internal("issueIds is empty".into()));
    }
    if body.issue_ids.len() > BULK_LIMIT {
        return Err(AppError::Internal(format!(
            "too many: {} > {}",
            body.issue_ids.len(),
            BULK_LIMIT
        )));
    }
    // Assign action takes the assignee uuid (or explicit null) instead
    // of touching `status`.
    if body.action == "assign" {
        let assignee = body
            .assignee_user_id
            .as_ref()
            .ok_or_else(|| AppError::Internal("assigneeUserId required for assign".into()))?;
        let result = sqlx::query(
            "UPDATE issues SET assignee_user_id = $1 \
             WHERE project_id = $2 AND id = ANY($3::uuid[])",
        )
        .bind(assignee.as_ref())
        .bind(project_id)
        .bind(&body.issue_ids)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(Json(BulkPatchResponse {
            updated: result.rows_affected(),
        }));
    }

    let target_status = match body.action.as_str() {
        "resolve" => "resolved",
        "silence" => "silenced",
        "close" => "closed",
        "reopen" => "active",
        other => {
            return Err(AppError::Internal(format!("invalid action '{other}'")));
        }
    };

    let result = sqlx::query(
        r#"
        UPDATE issues SET
            status = $1,
            resolved_at = CASE WHEN $1 = 'resolved' THEN now() ELSE NULL END,
            resolved_in_release = CASE WHEN $1 = 'resolved' THEN last_release ELSE NULL END,
            regressed_at = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_at END,
            regressed_in_release = CASE WHEN $1 = 'resolved' THEN NULL ELSE regressed_in_release END
        WHERE project_id = $2 AND id = ANY($3::uuid[])
        "#,
    )
    .bind(target_status)
    .bind(project_id)
    .bind(&body.issue_ids)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(BulkPatchResponse {
        updated: result.rows_affected(),
    }))
}

// Phase 25 sub-B: source preview for a stack frame.
//
// The dashboard pops a drawer when the user clicks a frame; this
// endpoint returns ±N lines of the original source around the line
// the raw frame reverse-maps to. We always read the *raw* line/col
// (the dashboard sends the frame index as it appears in the rendered
// stack — index is stable because symbolication rewrites in place).
//
// `cause` is the depth in the cause chain — 0 = primary error,
// 1 = first cause, etc. Capped at 10 (matches protocol's nesting
// limit).

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSourceQuery {
    pub frame: usize,
    #[serde(default)]
    pub cause: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSourceResponse {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub before: Vec<String>,
    pub at: String,
    pub after: Vec<String>,
}

const FRAME_SOURCE_CONTEXT_LINES: usize = 5;
const CAUSE_CHAIN_MAX: usize = 10;

pub async fn frame_source(
    State(state): State<AppState>,
    Path((project_id, event_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<FrameSourceQuery>,
) -> Result<Json<FrameSourceResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    if q.cause > CAUSE_CHAIN_MAX {
        return Err(AppError::Internal(format!(
            "cause depth {} > {}",
            q.cause, CAUSE_CHAIN_MAX
        )));
    }

    // Pull the raw payload — symbolicate hasn't been applied yet, so
    // the line/col we read are pre-sourcemap (= the JS bundle line/col).
    let row: Option<(String, serde_json::Value)> = sqlx::query_as(
        "SELECT release, payload FROM events WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(event_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let (release, payload) = row.ok_or(AppError::NotFound)?;

    // Walk the cause chain `q.cause` hops, then index into stack.
    let mut node = payload
        .get("error")
        .ok_or_else(|| AppError::Internal("event has no error".into()))?;
    for _ in 0..q.cause {
        node = match node.get("cause") {
            Some(c) if !c.is_null() => c,
            _ => return Err(AppError::NotFound),
        };
    }
    let stack = node
        .get("stack")
        .and_then(|s| s.as_array())
        .ok_or(AppError::NotFound)?;
    let frame = stack.get(q.frame).ok_or(AppError::NotFound)?;
    // If the frame was symbolicated at ingest its line/column are the
    // *source* position; the reverse-map lookup needs the bundle
    // position, which we stashed as rawLine/rawColumn.
    let pick = |sym: &str, raw: &str| {
        frame
            .get(raw)
            .and_then(|v| v.as_u64())
            .or_else(|| frame.get(sym).and_then(|v| v.as_u64()))
            .unwrap_or(0) as u32
    };
    let line = pick("line", "rawLine");
    let column = pick("column", "rawColumn");
    if line == 0 {
        return Err(AppError::NotFound);
    }

    let window = crate::symbolicate::source_for_frame(
        pool,
        &release,
        line,
        column,
        FRAME_SOURCE_CONTEXT_LINES,
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .ok_or(AppError::NotFound)?;

    Ok(Json(FrameSourceResponse {
        after: window.after,
        at: window.at,
        before: window.before,
        column: window.column,
        file: window.file,
        line: window.line,
    }))
}

// Phase 25 sub-E: per-issue comment thread + activity log.
//
// `activity` is a unified stream merging:
//   - kind="comment": rows from issue_comments
//   - kind="resolved" / "regressed": derived from issues.resolved_at /
//     regressed_at + the *_in_release columns.
//
// Sorted by `at` ascending — comments stay in chronological order
// alongside the status flips from sub-D's regression detection. We
// don't read audit_logs here: those are org-level, comments are
// per-issue, and conflating them muddies both. When a future sub adds
// per-issue audit (assign / fix-in-release), it'll layer on top of
// this stream cleanly.

const COMMENT_BODY_MIN: usize = 1;
const COMMENT_BODY_MAX: usize = 2000;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct CommentRow {
    id: Uuid,
    body: String,
    author_id: Option<Uuid>,
    author_email: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind")]
pub enum ActivityEntry {
    #[serde(rename = "comment", rename_all = "camelCase")]
    Comment {
        id: Uuid,
        body: String,
        author_id: Option<Uuid>,
        author_email: Option<String>,
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
    },
    #[serde(rename = "resolved", rename_all = "camelCase")]
    Resolved {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        release: Option<String>,
    },
    #[serde(rename = "regressed", rename_all = "camelCase")]
    Regressed {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        release: Option<String>,
    },
}

impl ActivityEntry {
    fn at(&self) -> OffsetDateTime {
        match self {
            ActivityEntry::Comment { at, .. }
            | ActivityEntry::Resolved { at, .. }
            | ActivityEntry::Regressed { at, .. } => *at,
        }
    }
}

pub async fn list_issue_activity(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ActivityEntry>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    // Project scoping is enforced upstream by require_project_in_org.
    let comments: Vec<CommentRow> = sqlx::query_as(
        r#"
        SELECT c.id, c.body, c.author_id, u.email AS author_email, c.created_at
        FROM issue_comments c
        LEFT JOIN users u ON u.id = c.author_id
        JOIN issues i ON i.id = c.issue_id
        WHERE c.issue_id = $1 AND i.project_id = $2
        ORDER BY c.created_at ASC
        "#,
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let issue_status: Option<(
        Option<OffsetDateTime>,
        Option<String>,
        Option<OffsetDateTime>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT resolved_at, resolved_in_release, regressed_at, regressed_in_release \
         FROM issues WHERE id = $1 AND project_id = $2",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut out: Vec<ActivityEntry> = comments
        .into_iter()
        .map(|c| ActivityEntry::Comment {
            at: c.created_at,
            author_email: c.author_email,
            author_id: c.author_id,
            body: c.body,
            id: c.id,
        })
        .collect();
    if let Some((res_at, res_rel, reg_at, reg_rel)) = issue_status {
        if let Some(at) = res_at {
            out.push(ActivityEntry::Resolved { at, release: res_rel });
        }
        if let Some(at) = reg_at {
            out.push(ActivityEntry::Regressed { at, release: reg_rel });
        }
    }
    out.sort_by_key(ActivityEntry::at);
    Ok(Json(out))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommentRequest {
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommentResponse {
    pub id: Uuid,
}

pub async fn create_issue_comment(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<CreateCommentRequest>,
) -> Result<(http::StatusCode, Json<CreateCommentResponse>), AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let trimmed = body.body.trim();
    let len = trimmed.chars().count();
    if len < COMMENT_BODY_MIN || len > COMMENT_BODY_MAX {
        return Err(AppError::Internal(format!(
            "comment body length {len} not in [{COMMENT_BODY_MIN}, {COMMENT_BODY_MAX}]"
        )));
    }

    let author_id = match caller {
        AdminCaller::User { id, .. } => id,
        // Tokens / legacy admin can't author — comments need a user.
        _ => return Err(AppError::Forbidden),
    };

    // Verify the issue actually belongs to this project (require_project_in_org
    // gates project_id but we still want issue ↔ project FK confirmed).
    let exists: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM issues WHERE id = $1 AND project_id = $2",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }

    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO issue_comments (id, issue_id, author_id, body) VALUES ($1, $2, $3, $4)",
    )
    .bind(id)
    .bind(issue_id)
    .bind(author_id)
    .bind(trimmed)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok((http::StatusCode::CREATED, Json(CreateCommentResponse { id })))
}

pub async fn delete_issue_comment(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id, comment_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<http::StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let row: Option<(Option<Uuid>, Uuid)> = sqlx::query_as(
        "SELECT c.author_id, i.project_id \
         FROM issue_comments c JOIN issues i ON i.id = c.issue_id \
         WHERE c.id = $1 AND c.issue_id = $2",
    )
    .bind(comment_id)
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let (author_id, comment_project_id) = row.ok_or(AppError::NotFound)?;
    if comment_project_id != project_id {
        return Err(AppError::NotFound);
    }

    let allowed = match caller {
        AdminCaller::User { id, .. } => Some(id) == author_id,
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => true,
    };
    if !allowed {
        return Err(AppError::Forbidden);
    }

    sqlx::query("DELETE FROM issue_comments WHERE id = $1")
        .bind(comment_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(http::StatusCode::NO_CONTENT)
}

pub async fn list_events_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<ListEventsQuery>,
) -> Result<Json<Vec<EventRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let symbolicated = q.symbolicated.unwrap_or(true);
    let days = q.days.unwrap_or(90).clamp(1, 365);

    let mut rows: Vec<EventRow> = sqlx::query_as(
        r#"
        SELECT id, occurred_at, received_at, platform, release, environment,
               error_type, error_message, payload, trace_id, span_id
        FROM events
        WHERE project_id = $1
          AND issue_id = $2
          AND received_at >= now() - make_interval(days => $3::int)
        ORDER BY received_at DESC
        LIMIT $4
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .bind(days as i32)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    if symbolicated {
        for row in rows.iter_mut() {
            // Best-effort: leave raw frames in place on any failure.
            // Three passes, layered so each pass is a no-op on frames
            // it doesn't own:
            //   1. JS sourcemap   — RN bridge frames sitting at the top
            //   2. iOS DWARF      — native frames with debugId/instr
            //   3. Android proguard — JVM frames with class.method shape
            let _ = crate::symbolicate::symbolicate_payload(
                pool,
                &row.release,
                &mut row.payload,
            )
            .await;
            crate::symbolicate_ios::symbolicate_payload(pool, project_id, &mut row.payload)
                .await;
            crate::symbolicate_android::symbolicate_payload(
                pool,
                project_id,
                Some(&row.release),
                &mut row.payload,
            )
            .await;
        }
    }

    Ok(Json(rows))
}
