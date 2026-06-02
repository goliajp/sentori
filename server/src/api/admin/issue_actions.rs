// Issue merge + bulk patch — heavier write-side actions.
//
// v1.1 P2 split-out of `api/admin.rs`.

use axum::{
    extract::{Extension, Json, Path, State},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{deserialize_double_option, BULK_LIMIT};
use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeIssueBody {
    pub target_issue_id: Uuid,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeIssueResponse {
    pub events_moved: i64,
    pub target_issue_id: Uuid,
}

pub async fn merge_issue(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<MergeIssueBody>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    if issue_id == body.target_issue_id {
        return Ok((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "selfMerge" })),
        )
            .into_response());
    }

    let both: Vec<(Uuid,)> =
        sqlx::query_as("SELECT id FROM issues WHERE project_id = $1 AND id = ANY($2::UUID[])")
            .bind(project_id)
            .bind(vec![issue_id, body.target_issue_id])
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    if both.len() < 2 {
        return Ok((
            axum::http::StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "issueNotFound" })),
        )
            .into_response());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let moved: i64 = sqlx::query_scalar(
        "WITH moved AS (\
             UPDATE events SET issue_id = $1 WHERE issue_id = $2 \
             RETURNING 1\
         ) SELECT COUNT(*) FROM moved",
    )
    .bind(body.target_issue_id)
    .bind(issue_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    sqlx::query(
        "UPDATE issues \
         SET event_count = event_count + $2, \
             first_seen = LEAST(first_seen, (SELECT first_seen FROM issues WHERE id = $3)), \
             last_seen = GREATEST(last_seen, (SELECT last_seen FROM issues WHERE id = $3)) \
         WHERE id = $1",
    )
    .bind(body.target_issue_id)
    .bind(moved)
    .bind(issue_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    sqlx::query("DELETE FROM issues WHERE id = $1")
        .bind(issue_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let actor = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };

    if let Ok(org_id) =
        sqlx::query_scalar::<_, Uuid>("SELECT org_id FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_one(pool)
            .await
    {
        crate::audit::record(
            pool,
            org_id,
            actor,
            crate::audit::actions::ISSUE_MERGED,
            crate::audit::targets::PROJECT,
            Some(project_id),
            serde_json::json!({
                "source": issue_id,
                "target": body.target_issue_id,
                "eventsMoved": moved,
            }),
        )
        .await;
    }

    // v1.2 W5: record the merge on the surviving target. We can't log
    // on the source issue — its row (and its activity_log rows by FK
    // cascade) was deleted in the txn above.
    crate::activity_log::write(
        pool,
        body.target_issue_id,
        actor,
        crate::activity_log::verb::MERGED,
        serde_json::json!({
            "fromIssueId": issue_id,
            "eventsMoved": moved,
        }),
    )
    .await;

    Ok(Json(MergeIssueResponse {
        events_moved: moved,
        target_issue_id: body.target_issue_id,
    })
    .into_response())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BulkPatchRequest {
    pub issue_ids: Vec<Uuid>,
    pub action: String,
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
    Extension(caller): Extension<AdminCaller>,
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
    let actor = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };
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

        // v1.2 W5: one assignee_changed entry per affected issue.
        // Bulk assign doesn't snapshot per-issue `from`; payload notes
        // `bulk: true` so timelines can render the "via bulk" hint.
        let new_assignee = assignee.as_ref().copied();
        for id in &body.issue_ids {
            crate::activity_log::write(
                pool,
                *id,
                actor,
                crate::activity_log::verb::ASSIGNEE_CHANGED,
                serde_json::json!({
                    "to": new_assignee,
                    "bulk": true,
                }),
            )
            .await;
        }

        return Ok(Json(BulkPatchResponse {
            updated: result.rows_affected(),
        }));
    }

    let target_status = match body.action.as_str() {
        "resolve" => "resolved",
        "silence" => "silenced",
        // v1.2 W6 — soft-silence: stays in active queue, no alerts.
        "mute" => "muted",
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

    // v1.2 W5: one status_changed entry per affected issue. No `from`
    // (the UPDATE didn't snapshot the prior state) — the payload's
    // `bulk: true` marker tells the timeline why.
    for id in &body.issue_ids {
        crate::activity_log::write(
            pool,
            *id,
            actor,
            crate::activity_log::verb::STATUS_CHANGED,
            serde_json::json!({
                "to": target_status,
                "bulk": true,
            }),
        )
        .await;
    }

    Ok(Json(BulkPatchResponse {
        updated: result.rows_affected(),
    }))
}
