// v1.2 W5 — write into the per-issue activity_log table.
//
// Every issue mutation (status change, assignee change, merge,
// bulk patch, comment, ingest-driven auto-regression) calls
// `activity_log::write` so the dashboard timeline can show "who did
// what when" instead of synthesising it from `resolved_at` /
// `regressed_at` columns.
//
// Best-effort semantics: a failed insert logs a warning and does NOT
// fail the parent mutation. Audit detail is valuable but should not
// be the reason a user-facing patch_issue returns 5xx. If audit
// integrity ever becomes a compliance requirement, switch to
// transactional bundling at the call site.

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

/// Verbs are free-form text but the dashboard recognises a known set
/// for rendering. Unknown verbs render as a generic activity row.
pub mod verb {
    pub const STATUS_CHANGED: &str = "status_changed";
    pub const ASSIGNEE_CHANGED: &str = "assignee_changed";
    pub const COMMENTED: &str = "commented";
    pub const MERGED: &str = "merged";
    pub const BULK_PATCHED: &str = "bulk_patched";
    /// Ingest-driven, no actor.
    pub const REGRESSED: &str = "regressed";
    /// v1.2 W4 — priority + labels.
    pub const PRIORITY_CHANGED: &str = "priority_changed";
    pub const LABELS_CHANGED: &str = "labels_changed";
}

pub async fn write(
    pool: &PgPool,
    issue_id: Uuid,
    actor_id: Option<Uuid>,
    verb: &str,
    payload: Value,
) {
    let result = sqlx::query(
        "INSERT INTO activity_log (issue_id, actor_id, verb, payload) VALUES ($1, $2, $3, $4)",
    )
    .bind(issue_id)
    .bind(actor_id)
    .bind(verb)
    .bind(&payload)
    .execute(pool)
    .await;
    if let Err(e) = result {
        tracing::warn!(
            issue_id = %issue_id,
            verb,
            error = %e,
            "activity_log write failed (mutation continued)"
        );
        return;
    }
    // v1.2 W8: fan out to watchers (minus the actor). tokio::spawn so
    // the mutation path stays unblocked by the watcher-table scan +
    // per-watcher insert.
    let pool = pool.clone();
    let verb = verb.to_string();
    tokio::spawn(async move {
        crate::notifications::fan_out(&pool, issue_id, actor_id, &verb, &payload).await;
    });
}
