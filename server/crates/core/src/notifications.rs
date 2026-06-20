// v1.2 W8 — per-user notification fan-out + SSE broadcast.
//
// Activity_log::write is the central trigger: every time an issue
// mutation lands a row in `activity_log`, we (a) insert one
// `notifications` row per watcher (minus the actor, so a user doesn't
// get pinged for their own action), and (b) emit one item on the
// global tokio broadcast channel so any connected SSE listener whose
// user_id matches gets a real-time push.
//
// Fan-out happens in a tokio::spawn so the mutation path stays fast.
// If the fan-out task fails (e.g. db hiccup), we log + drop — same
// best-effort semantics as the activity_log writes themselves; this
// is observability of mutations, not the mutation itself.
//
// The broadcast channel uses `tokio::sync::broadcast::Receiver`. We
// keep one global sender (boxed in an `OnceLock`) — connected SSE
// clients each subscribe; lagged subscribers (slow clients) drop
// frames rather than blocking the producer. That's fine: any UI
// already reads the persisted `notifications` table on connect, so
// dropped SSE frames just mean "refresh would have shown it sooner."

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::sync::broadcast::{self, Receiver, Sender};
use uuid::Uuid;

const CHANNEL_CAP: usize = 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationEvent {
    pub id: i64,
    pub user_id: Uuid,
    pub issue_id: Uuid,
    pub kind: String,
    pub payload: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

static TX: OnceLock<Sender<NotificationEvent>> = OnceLock::new();

fn tx() -> &'static Sender<NotificationEvent> {
    TX.get_or_init(|| broadcast::channel(CHANNEL_CAP).0)
}

/// Subscribe to the broadcast feed. The caller is expected to filter
/// by `user_id`. Each fresh `subscribe()` starts at the current
/// channel head — older items the caller missed should be fetched
/// from the persisted `notifications` table.
pub fn subscribe() -> Receiver<NotificationEvent> {
    tx().subscribe()
}

/// Fan one activity_log write out to all watchers minus the actor.
/// Best-effort: db errors get logged and the parent mutation
/// continues.
///
/// v1.3 W14 + v1.4 W18: filtered by the watcher's
/// notification_preferences (global per-kind mute) AND by
/// issue_user_mutes (per-issue mute). Users who hit either filter
/// don't get the row; users with no row in either table receive by
/// default.
pub async fn fan_out(
    pool: &PgPool,
    issue_id: Uuid,
    actor_id: Option<Uuid>,
    verb: &str,
    payload: &Value,
) {
    let actor_id_opt = actor_id;
    let res = sqlx::query_as::<
        _,
        (i64, Uuid, OffsetDateTime),
    >(
        r#"
        INSERT INTO notifications (user_id, issue_id, kind, payload)
        SELECT w.user_id, w.issue_id, $3::TEXT, $4::JSONB
        FROM watchers w
        LEFT JOIN notification_preferences np ON np.user_id = w.user_id
        LEFT JOIN issue_user_mutes ium
            ON ium.user_id = w.user_id AND ium.issue_id = w.issue_id
        WHERE w.issue_id = $1
          AND ($2::UUID IS NULL OR w.user_id <> $2)
          AND ($3::TEXT <> ALL(COALESCE(np.muted_kinds, ARRAY[]::TEXT[])))
          AND ium.user_id IS NULL
        RETURNING id, user_id, created_at
        "#,
    )
    .bind(issue_id)
    .bind(actor_id_opt)
    .bind(verb)
    .bind(payload)
    .fetch_all(pool)
    .await;
    let rows = match res {
        Ok(rs) => rs,
        Err(e) => {
            tracing::warn!(
                %issue_id,
                verb,
                error = %e,
                "notifications fan_out insert failed (mutation continued)"
            );
            return;
        }
    };
    for (id, user_id, created_at) in rows {
        let _ = tx().send(NotificationEvent {
            created_at,
            id,
            issue_id,
            kind: verb.to_string(),
            payload: payload.clone(),
            user_id,
        });
        // v1.4 W16: also try to dispatch an email for this recipient
        // when their preferences say so. Best-effort + behind its own
        // log table, so a flaky SMTP relay doesn't block fan-out.
        let pool2 = pool.clone();
        let verb2 = verb.to_string();
        let payload2 = payload.clone();
        tokio::spawn(async move {
            crate::notification_email::maybe_send(
                &pool2,
                id,
                user_id,
                issue_id,
                &verb2,
                &payload2,
            )
            .await;
        });
    }
}

/// Add a watcher row (idempotent). Used by patch_issue's
/// assignment path and the dashboard's per-issue Watch toggle.
pub async fn add_watcher(pool: &PgPool, issue_id: Uuid, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO watchers (issue_id, user_id) VALUES ($1, $2) \
         ON CONFLICT DO NOTHING",
    )
    .bind(issue_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_watcher(pool: &PgPool, issue_id: Uuid, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM watchers WHERE issue_id = $1 AND user_id = $2")
        .bind(issue_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// v1.4 W18 — per-issue mute toggle. Idempotent.
pub async fn add_issue_mute(pool: &PgPool, issue_id: Uuid, user_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO issue_user_mutes (user_id, issue_id) VALUES ($1, $2) \
         ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(issue_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_issue_mute(
    pool: &PgPool,
    issue_id: Uuid,
    user_id: Uuid,
) -> sqlx::Result<()> {
    sqlx::query("DELETE FROM issue_user_mutes WHERE user_id = $1 AND issue_id = $2")
        .bind(user_id)
        .bind(issue_id)
        .execute(pool)
        .await?;
    Ok(())
}
