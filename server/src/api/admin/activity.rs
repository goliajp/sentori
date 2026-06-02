// Per-issue activity feed + comments.
//
// v1.1 P2 split-out of `api/admin.rs`.

use axum::{
    extract::{Extension, Json, Path, State},
    http,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use super::{COMMENT_BODY_MAX, COMMENT_BODY_MIN};
use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

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
        actor_id: Option<Uuid>,
    },
    #[serde(rename = "regressed", rename_all = "camelCase")]
    Regressed {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        release: Option<String>,
    },
    // v1.2 W5: every other status transition (silenced, closed,
    // muted, reopened) lands here. Comment-level + assignee + merge
    // each get their own variant so the dashboard can render the
    // right icon without parsing the verb string client-side.
    #[serde(rename = "statusChanged", rename_all = "camelCase")]
    StatusChanged {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        actor_id: Option<Uuid>,
        from: Option<String>,
        to: String,
        bulk: bool,
    },
    #[serde(rename = "assigneeChanged", rename_all = "camelCase")]
    AssigneeChanged {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        actor_id: Option<Uuid>,
        from: Option<Uuid>,
        to: Option<Uuid>,
        bulk: bool,
    },
    #[serde(rename = "merged", rename_all = "camelCase")]
    Merged {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        actor_id: Option<Uuid>,
        from_issue_id: Option<Uuid>,
        events_moved: Option<i64>,
    },
    #[serde(rename = "priorityChanged", rename_all = "camelCase")]
    PriorityChanged {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        actor_id: Option<Uuid>,
        from: Option<String>,
        to: String,
    },
    #[serde(rename = "labelsChanged", rename_all = "camelCase")]
    LabelsChanged {
        #[serde(with = "time::serde::rfc3339")]
        at: OffsetDateTime,
        actor_id: Option<Uuid>,
        added: Vec<String>,
        removed: Vec<String>,
    },
}

impl ActivityEntry {
    fn at(&self) -> OffsetDateTime {
        match self {
            ActivityEntry::Comment { at, .. }
            | ActivityEntry::Resolved { at, .. }
            | ActivityEntry::Regressed { at, .. }
            | ActivityEntry::StatusChanged { at, .. }
            | ActivityEntry::AssigneeChanged { at, .. }
            | ActivityEntry::Merged { at, .. }
            | ActivityEntry::PriorityChanged { at, .. }
            | ActivityEntry::LabelsChanged { at, .. } => *at,
        }
    }
}

#[derive(Debug, sqlx::FromRow)]
struct ActivityLogRow {
    actor_id: Option<Uuid>,
    verb: String,
    payload: serde_json::Value,
    at: OffsetDateTime,
}

pub async fn list_issue_activity(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Vec<ActivityEntry>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

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

    // v1.2 W5: read the structured audit feed. Exclude `commented`
    // rows — those are duplicates of the issue_comments query above,
    // which carries the full body (the activity_log row only stores
    // a 200-char preview).
    let log_rows: Vec<ActivityLogRow> = sqlx::query_as(
        r#"
        SELECT a.actor_id, a.verb, a.payload, a.at
        FROM activity_log a
        JOIN issues i ON i.id = a.issue_id
        WHERE a.issue_id = $1 AND i.project_id = $2 AND a.verb <> 'commented'
        ORDER BY a.at ASC
        "#,
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Synthesised legacy resolve/regress entries are kept ONLY when
    // activity_log has no equivalent row — i.e. the issue's
    // resolve/regress predates the W5 migration. New issues get
    // canonical rows from activity_log.
    let mut has_log_resolved = false;
    let mut has_log_regressed = false;
    for r in &log_rows {
        if r.verb == crate::activity_log::verb::STATUS_CHANGED {
            if r.payload.get("to").and_then(|v| v.as_str()) == Some("resolved") {
                has_log_resolved = true;
            }
        }
        if r.verb == crate::activity_log::verb::REGRESSED {
            has_log_regressed = true;
        }
    }

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

    for r in log_rows {
        let entry = activity_row_to_entry(r);
        if let Some(e) = entry {
            out.push(e);
        }
    }

    if let Some((res_at, res_rel, reg_at, reg_rel)) = issue_status {
        if let Some(at) = res_at {
            if !has_log_resolved {
                out.push(ActivityEntry::Resolved {
                    at,
                    release: res_rel,
                    actor_id: None,
                });
            }
        }
        if let Some(at) = reg_at {
            if !has_log_regressed {
                out.push(ActivityEntry::Regressed {
                    at,
                    release: reg_rel,
                });
            }
        }
    }
    out.sort_by_key(ActivityEntry::at);
    Ok(Json(out))
}

fn activity_row_to_entry(r: ActivityLogRow) -> Option<ActivityEntry> {
    let payload = &r.payload;
    match r.verb.as_str() {
        v if v == crate::activity_log::verb::STATUS_CHANGED => {
            let to = payload.get("to").and_then(|v| v.as_str())?.to_string();
            let from = payload
                .get("from")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let release = payload
                .get("release")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let bulk = payload.get("bulk").and_then(|v| v.as_bool()).unwrap_or(false);
            // Promote known terminals to the legacy variants so the
            // dashboard's existing renderers (and the test asserting
            // `kind == "resolved"`) keep working unchanged.
            if to == "resolved" {
                Some(ActivityEntry::Resolved {
                    at: r.at,
                    actor_id: r.actor_id,
                    release,
                })
            } else {
                Some(ActivityEntry::StatusChanged {
                    at: r.at,
                    actor_id: r.actor_id,
                    bulk,
                    from,
                    to,
                })
            }
        }
        v if v == crate::activity_log::verb::REGRESSED => {
            let release = payload
                .get("release")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(ActivityEntry::Regressed { at: r.at, release })
        }
        v if v == crate::activity_log::verb::ASSIGNEE_CHANGED => {
            let parse_uuid = |k: &str| {
                payload
                    .get(k)
                    .and_then(|v| v.as_str())
                    .and_then(|s| Uuid::parse_str(s).ok())
            };
            let bulk = payload.get("bulk").and_then(|v| v.as_bool()).unwrap_or(false);
            Some(ActivityEntry::AssigneeChanged {
                at: r.at,
                actor_id: r.actor_id,
                bulk,
                from: parse_uuid("from"),
                to: parse_uuid("to"),
            })
        }
        v if v == crate::activity_log::verb::MERGED => {
            let from_issue_id = payload
                .get("fromIssueId")
                .and_then(|v| v.as_str())
                .and_then(|s| Uuid::parse_str(s).ok());
            let events_moved = payload.get("eventsMoved").and_then(|v| v.as_i64());
            Some(ActivityEntry::Merged {
                at: r.at,
                actor_id: r.actor_id,
                events_moved,
                from_issue_id,
            })
        }
        v if v == crate::activity_log::verb::PRIORITY_CHANGED => {
            let to = payload.get("to").and_then(|v| v.as_str())?.to_string();
            let from = payload
                .get("from")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Some(ActivityEntry::PriorityChanged {
                at: r.at,
                actor_id: r.actor_id,
                from,
                to,
            })
        }
        v if v == crate::activity_log::verb::LABELS_CHANGED => {
            let pull = |k: &str| {
                payload
                    .get(k)
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            };
            Some(ActivityEntry::LabelsChanged {
                at: r.at,
                actor_id: r.actor_id,
                added: pull("added"),
                removed: pull("removed"),
            })
        }
        _ => None,
    }
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
        _ => return Err(AppError::Forbidden),
    };

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

    // v1.2 W5: mirror the comment into activity_log so a single
    // ORDER BY at over one table renders the unified timeline. The
    // payload preview is capped to avoid bloating jsonb on long
    // bodies — the comment table is still the source of truth for
    // the full text + the dashboard's render path.
    let preview: String = trimmed.chars().take(200).collect();
    crate::activity_log::write(
        pool,
        issue_id,
        Some(author_id),
        crate::activity_log::verb::COMMENTED,
        serde_json::json!({
            "commentId": id,
            "preview": preview,
        }),
    )
    .await;

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
