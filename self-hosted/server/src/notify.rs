//! Notification broadcast helpers — pushes a row into the
//! `notifications` table for every watcher of an issue when
//! an event (comment / status flip) happens.

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

/// Write an audit_log row. Best-effort; failure does not bubble
/// up — admin endpoint success is decoupled from the audit write.
pub async fn audit(
    pool: &PgPool,
    workspace_id: Uuid,
    project_id: Option<Uuid>,
    actor_user_id: Option<Uuid>,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    payload: Value,
) {
    let _ = sqlx::query(
        "INSERT INTO audit_logs (id, workspace_id, project_id, actor_user_id, action, \
            target_type, target_id, payload) \
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(workspace_id)
    .bind(project_id)
    .bind(actor_user_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(&payload)
    .execute(pool)
    .await;
}

/// Insert a notification per watcher (sans actor — they don't
/// need to notify themselves of their own action).
pub async fn notify_issue_watchers(
    pool: &PgPool,
    issue_id: Uuid,
    actor_user_id: Option<Uuid>,
    kind: &str,
    payload: Value,
) {
    let _ = sqlx::query(
        "INSERT INTO notifications (id, user_id, kind, payload) \
         SELECT gen_random_uuid(), w.user_id, $1, $2 \
         FROM issue_watchers w \
         WHERE w.issue_id = $3 AND w.user_id IS DISTINCT FROM $4",
    )
    .bind(kind)
    .bind(&payload)
    .bind(issue_id)
    .bind(actor_user_id)
    .execute(pool)
    .await;
}
