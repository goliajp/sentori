// Issue list / detail / related / releases / patch.
//
// v1.1 P2 split-out of `api/admin.rs`.

use axum::{
    extract::{Extension, Json, Path, Query, State},
    http::HeaderValue,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    default_status, deserialize_double_option, encode_cursor, parse_cursor, ALLOWED_STATUSES,
};
use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

/// v1.2 W5: pull the user id out of an AdminCaller — None for legacy
/// admin / dev-token paths, so activity_log rows on those flows have
/// a NULL `actor_id`. Mirrors `create_issue_comment`'s pattern.
fn actor_id_of(caller: &AdminCaller) -> Option<Uuid> {
    match caller {
        AdminCaller::User { id, .. } => Some(*id),
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => None,
    }
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
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub resolved_at: Option<OffsetDateTime>,
    pub resolved_in_release: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub regressed_at: Option<OffsetDateTime>,
    pub regressed_in_release: Option<String>,
    pub assignee_user_id: Option<Uuid>,
    pub assignee_email: Option<String>,
    /// v1.2 W4 — triage axis #2. Always present (default 'p3').
    pub priority: String,
    /// v1.2 W4 — operator-typed tags. Always present (defaults to []).
    pub labels: Vec<String>,
    /// v2.4 — distinct identity fingerprints (from
    /// `identity_fingerprints`) that touched this issue. The
    /// privacy-aware counterpart to `event_count`. List queries set
    /// this to 0 to keep the hot path cheap; only `issue_detail`
    /// (cold path) computes the real number via subquery.
    #[serde(default)]
    pub affected_users: i64,
}

const ALLOWED_PRIORITIES: &[&str] = &["p0", "p1", "p2", "p3"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListIssuesQuery {
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub env: Option<String>,
    #[serde(default)]
    pub release: Option<String>,
    #[serde(default)]
    pub error_type: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub last_seen_after: Option<OffsetDateTime>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub search: Option<String>,
    /// v1.2 W4 — single priority filter (e.g. `?priority=p0`).
    /// Combine multiple values via `?priority=p0,p1`.
    #[serde(default)]
    pub priority: Option<String>,
    /// v1.2 W4 — labels filter, comma-separated, any-of match.
    #[serde(default)]
    pub labels: Option<String>,
}

pub async fn list_issues(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<ListIssuesQuery>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);

    let status_filter: Option<&str> = match q.status.as_str() {
        "" | "any" => None,
        s => Some(s),
    };
    let cursor: Option<(OffsetDateTime, Uuid)> = q.cursor.as_deref().and_then(parse_cursor);
    let search_filter: Option<&str> = q
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // v1.2 W4: comma-separated CSV → Vec<String> for both filters.
    // Empty / unspecified → None → SQL ANY skip via the IS NULL guards.
    fn csv(opt: Option<&str>) -> Option<Vec<String>> {
        opt.map(|s| s.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
            .filter(|v: &Vec<String>| !v.is_empty())
    }
    let priority_filter = csv(q.priority.as_deref());
    let labels_filter = csv(q.labels.as_deref());

    let rows: Vec<IssueRow> = sqlx::query_as(
        r#"
        SELECT i.id, i.fingerprint, i.error_type, i.message_sample, i.status,
               i.first_seen, i.last_seen, i.event_count,
               i.last_environment, i.last_release,
               i.resolved_at, i.resolved_in_release,
               i.regressed_at, i.regressed_in_release,
               i.assignee_user_id,
               u.email AS assignee_email,
               i.priority, i.labels,
               0::BIGINT AS affected_users
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
          AND ($10::TEXT IS NULL
               OR i.search_vector @@ plainto_tsquery('simple', $10))
          AND ($11::TEXT[] IS NULL OR i.priority = ANY($11))
          AND ($12::TEXT[] IS NULL OR i.labels && $12)
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
    .bind(search_filter)
    .bind(priority_filter.as_deref())
    .bind(labels_filter.as_deref())
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

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

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RelatedIssueRow {
    pub id: Uuid,
    pub error_type: String,
    pub message_sample: String,
    pub status: String,
    pub event_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
}

pub async fn related_issues(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<RelatedIssueRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let rows: Vec<RelatedIssueRow> = sqlx::query_as(
        r#"
        SELECT id, error_type, message_sample, status, event_count, last_seen
        FROM issues
        WHERE project_id = $1
          AND id != $2
          AND error_type = (
              SELECT error_type FROM issues WHERE project_id = $1 AND id = $2
          )
        ORDER BY last_seen DESC
        LIMIT 5
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(rows))
}

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
    Extension(caller): Extension<AdminCaller>,
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
               u.email AS assignee_email,
               i.priority, i.labels,
               COALESCE((
                 SELECT COUNT(DISTINCT f.fingerprint)::BIGINT
                 FROM events e
                 JOIN identity_fingerprints f ON f.event_id = e.id
                 WHERE e.issue_id = i.id
               ), 0) AS affected_users
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

    // v1.4 W19 — auto-watch on first issue-detail open. Idempotent.
    // Triggered for any authenticated user (not legacy admin / dev
    // token), so the operator who first navigates to an issue becomes
    // a watcher and starts receiving notifications.
    if let (Some(_), AdminCaller::User { id: user_id, .. }) = (&row, &caller) {
        let _ = crate::notifications::add_watcher(pool, issue_id, *user_id).await;
    }

    row.map(Json).ok_or(AppError::NotFound)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PatchIssueRequest {
    pub status: Option<String>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub assignee_user_id: Option<Option<Uuid>>,
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub resolved_in_release: Option<Option<String>>,
    /// v1.2 W4 — set the triage priority. Single string, must be one
    /// of ALLOWED_PRIORITIES. Absent → unchanged.
    pub priority: Option<String>,
    /// v1.2 W4 — replace the full label set. Absent → unchanged; an
    /// empty array clears all labels.
    pub labels: Option<Vec<String>>,
}

impl Default for PatchIssueRequest {
    fn default() -> Self {
        Self {
            assignee_user_id: None,
            resolved_in_release: None,
            status: None,
            priority: None,
            labels: None,
        }
    }
}

pub async fn patch_issue(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PatchIssueRequest>,
) -> Result<Json<IssueRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let actor_id = actor_id_of(&caller);

    // v1.2 W5: snapshot the pre-mutation status + assignee + (W4)
    // priority + labels so the activity_log row can record `from` and
    // we can compute label diffs.
    let pre: Option<(String, Option<Uuid>, String, Vec<String>)> = sqlx::query_as(
        "SELECT status, assignee_user_id, priority, labels FROM issues \
         WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let (pre_status, pre_assignee, pre_priority, pre_labels): (
        Option<String>,
        Option<Uuid>,
        Option<String>,
        Vec<String>,
    ) = match pre {
        Some((status, assignee, priority, labels)) => {
            (Some(status), assignee, Some(priority), labels)
        }
        None => (None, None, None, Vec::new()),
    };

    if let Some(status) = &body.status {
        if !ALLOWED_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Internal(format!(
                "invalid status '{status}'; allowed: {ALLOWED_STATUSES:?}"
            )));
        }
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

        // v1.2 W5: audit-log the status change. Skip the entry if the
        // status didn't actually change (idempotent PATCH), so we
        // don't pollute timelines with no-op transitions.
        if pre_status.as_deref() != Some(status.as_str()) {
            crate::activity_log::write(
                pool,
                issue_id,
                actor_id,
                crate::activity_log::verb::STATUS_CHANGED,
                serde_json::json!({
                    "from": pre_status,
                    "to": status,
                    "release": release_override,
                }),
            )
            .await;
        }

        if status == "resolved" {
            let pool = pool.clone();
            tokio::spawn(async move {
                crate::integrations::dispatch::on_status_change(
                    &pool,
                    issue_id,
                    crate::integrations::IssueLifecycleEvent::Resolved,
                )
                .await;
            });
        }
    }

    if let Some(opt) = &body.assignee_user_id {
        sqlx::query("UPDATE issues SET assignee_user_id = $1 WHERE project_id = $2 AND id = $3")
            .bind(opt.as_ref())
            .bind(project_id)
            .bind(issue_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // v1.2 W5: log the assignee change (including unassign,
        // i.e. to=null) — but skip no-ops.
        let new_assignee = opt.as_ref().copied();
        if new_assignee != pre_assignee {
            crate::activity_log::write(
                pool,
                issue_id,
                actor_id,
                crate::activity_log::verb::ASSIGNEE_CHANGED,
                serde_json::json!({
                    "from": pre_assignee,
                    "to": new_assignee,
                }),
            )
            .await;
            // v1.2 W8: auto-watch the newly-assigned user. Idempotent
            // (ON CONFLICT DO NOTHING). Skip the unassign case
            // (new_assignee = None) — that's not an explicit subscribe.
            if let Some(uid) = new_assignee {
                let _ = crate::notifications::add_watcher(pool, issue_id, uid).await;
            }
        }
    }

    // v1.2 W4: priority.
    if let Some(priority) = &body.priority {
        if !ALLOWED_PRIORITIES.contains(&priority.as_str()) {
            return Err(AppError::Internal(format!(
                "invalid priority '{priority}'; allowed: {ALLOWED_PRIORITIES:?}"
            )));
        }
        sqlx::query("UPDATE issues SET priority = $1 WHERE project_id = $2 AND id = $3")
            .bind(priority)
            .bind(project_id)
            .bind(issue_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if pre_priority.as_deref() != Some(priority.as_str()) {
            crate::activity_log::write(
                pool,
                issue_id,
                actor_id,
                crate::activity_log::verb::PRIORITY_CHANGED,
                serde_json::json!({
                    "from": pre_priority,
                    "to": priority,
                }),
            )
            .await;
        }
    }

    // v1.2 W4: labels — full replacement set. Diff for activity_log
    // so the timeline shows what changed, not just "labels were
    // edited".
    if let Some(labels) = &body.labels {
        // Sort + dedup defensively (operators may submit duplicates).
        let mut new_labels = labels.clone();
        new_labels.sort();
        new_labels.dedup();
        sqlx::query("UPDATE issues SET labels = $1 WHERE project_id = $2 AND id = $3")
            .bind(&new_labels)
            .bind(project_id)
            .bind(issue_id)
            .execute(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let before: std::collections::BTreeSet<&str> =
            pre_labels.iter().map(|s| s.as_str()).collect();
        let after: std::collections::BTreeSet<&str> =
            new_labels.iter().map(|s| s.as_str()).collect();
        let added: Vec<&&str> = after.difference(&before).collect();
        let removed: Vec<&&str> = before.difference(&after).collect();
        if !added.is_empty() || !removed.is_empty() {
            crate::activity_log::write(
                pool,
                issue_id,
                actor_id,
                crate::activity_log::verb::LABELS_CHANGED,
                serde_json::json!({
                    "added": added,
                    "removed": removed,
                }),
            )
            .await;
        }
    }

    let row: Option<IssueRow> = sqlx::query_as(
        r#"
        SELECT i.id, i.fingerprint, i.error_type, i.message_sample, i.status,
               i.first_seen, i.last_seen, i.event_count,
               i.last_environment, i.last_release,
               i.resolved_at, i.resolved_in_release,
               i.regressed_at, i.regressed_in_release,
               i.assignee_user_id,
               u.email AS assignee_email,
               i.priority, i.labels,
               COALESCE((
                 SELECT COUNT(DISTINCT f.fingerprint)::BIGINT
                 FROM events e
                 JOIN identity_fingerprints f ON f.event_id = e.id
                 WHERE e.issue_id = i.id
               ), 0) AS affected_users
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
