// v1.2 W8 — notifications + watch admin endpoints.
//
//   GET    /admin/api/notifications              — list current user's notifications
//   POST   /admin/api/notifications/{id}/read    — mark one read
//   POST   /admin/api/notifications/read-all     — mark all unread as read
//   GET    /admin/api/notifications/stream       — SSE feed (filtered to caller user_id)
//   PUT    /admin/api/projects/{p}/issues/{i}/watch    — start watching
//   DELETE /admin/api/projects/{p}/issues/{i}/watch    — stop watching

use std::convert::Infallible;
use std::time::Duration;

use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        Json,
    },
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRow {
    pub id: i64,
    pub issue_id: Uuid,
    pub kind: String,
    pub payload: serde_json::Value,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub read_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    /// Default 50. Capped at 200.
    #[serde(default)]
    pub limit: Option<i64>,
    /// `?unread=true` filters to unread only.
    #[serde(default)]
    pub unread: Option<bool>,
}

pub async fn list_notifications(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<NotificationRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let unread_only = q.unread.unwrap_or(false);

    let rows: Vec<NotificationRow> = sqlx::query_as(
        r#"
        SELECT id, issue_id, kind, payload, read_at, created_at
        FROM notifications
        WHERE user_id = $1
          AND ($2::BOOL = FALSE OR read_at IS NULL)
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(user_id)
    .bind(unread_only)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("list notifications: {e}")))?;
    Ok(Json(rows))
}

pub async fn mark_read(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    let res = sqlx::query(
        "UPDATE notifications SET read_at = now() \
         WHERE id = $1 AND user_id = $2 AND read_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("mark_read: {e}")))?;
    if res.rows_affected() == 0 {
        // Either not yours, doesn't exist, or already read. 204 is
        // honest about the no-op without leaking ownership info.
        return Ok(StatusCode::NO_CONTENT);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn mark_all_read(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<MarkAllResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    let res = sqlx::query(
        "UPDATE notifications SET read_at = now() \
         WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("mark_all_read: {e}")))?;
    Ok(Json(MarkAllResponse {
        updated: res.rows_affected(),
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkAllResponse {
    pub updated: u64,
}

/// SSE stream. Sends one event per matching `NotificationEvent` from
/// the global broadcast channel. Slow clients lag and miss frames
/// silently — they'll catch up via the next GET /notifications poll.
pub async fn stream(
    Extension(caller): Extension<AdminCaller>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    let rx = crate::notifications::subscribe();
    let stream = BroadcastStream::new(rx).filter_map(move |item| match item {
        Ok(ev) if ev.user_id == user_id => match serde_json::to_string(&ev) {
            Ok(json) => Some(Ok(Event::default().event("notification").data(json))),
            Err(_) => None,
        },
        // Other recipients: skip silently.
        Ok(_) => None,
        // Lagged: skip; the persisted `GET` is the fallback.
        Err(_) => None,
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(30))))
}

pub async fn watch_issue(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    assert_issue_in_project(pool, project_id, issue_id).await?;
    crate::notifications::add_watcher(pool, issue_id, user_id)
        .await
        .map_err(|e| AppError::Internal(format!("watch: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unwatch_issue(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    assert_issue_in_project(pool, project_id, issue_id).await?;
    crate::notifications::remove_watcher(pool, issue_id, user_id)
        .await
        .map_err(|e| AppError::Internal(format!("unwatch: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn assert_issue_in_project(
    pool: &PgPool,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<(), AppError> {
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
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    pub watching: bool,
    /// v1.4 W18 — true when the caller has muted notifications for
    /// this specific issue (independent of per-kind global mute).
    pub muted: bool,
}

pub async fn watch_status(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<WatchStatus>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    assert_issue_in_project(pool, project_id, issue_id).await?;
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT user_id FROM watchers WHERE issue_id = $1 AND user_id = $2",
    )
    .bind(issue_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    // v1.4 W18: surface mute state alongside watching state so the
    // UI can render both controls in a single round-trip.
    let muted: Option<(Uuid,)> = sqlx::query_as(
        "SELECT user_id FROM issue_user_mutes WHERE issue_id = $1 AND user_id = $2",
    )
    .bind(issue_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(WatchStatus {
        muted: muted.is_some(),
        watching: row.is_some(),
    }))
}

/// v1.4 W18 — per-issue mute toggle.
pub async fn mute_issue(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    assert_issue_in_project(pool, project_id, issue_id).await?;
    crate::notifications::add_issue_mute(pool, issue_id, user_id)
        .await
        .map_err(|e| AppError::Internal(format!("mute: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn unmute_issue(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    assert_issue_in_project(pool, project_id, issue_id).await?;
    crate::notifications::remove_issue_mute(pool, issue_id, user_id)
        .await
        .map_err(|e| AppError::Internal(format!("unmute: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

// ── v1.3 W14 — per-user notification preferences ─────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPreferences {
    pub muted_kinds: Vec<String>,
    pub cadence: String,
    pub channels: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesPatch {
    pub muted_kinds: Vec<String>,
    pub cadence: String,
    pub channels: Vec<String>,
}

const ALLOWED_CADENCES: &[&str] = &["immediate", "hourly", "daily"];
const ALLOWED_CHANNELS: &[&str] = &["in_app", "email"];
const KNOWN_KINDS: &[&str] = &[
    "status_changed",
    "assignee_changed",
    "priority_changed",
    "labels_changed",
    "merged",
    "commented",
    "regressed",
];

pub async fn get_preferences(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<NotificationPreferences>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    let row: Option<NotificationPreferences> = sqlx::query_as(
        "SELECT muted_kinds, cadence, channels FROM notification_preferences WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("get_preferences: {e}")))?;
    // No row → return defaults so the dashboard form populates
    // cleanly without a separate "first-time" branch.
    Ok(Json(row.unwrap_or_else(|| NotificationPreferences {
        cadence: "immediate".into(),
        channels: vec!["in_app".into()],
        muted_kinds: vec![],
    })))
}

/// v1.4 W16: trigger a test email to the operator's own address.
/// Useful so they can validate SMTP is reachable from inside the
/// dashboard without waiting for a real notification.
pub async fn send_test_email(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<TestEmailResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let (user_id, email) = match caller {
        AdminCaller::User { id, email } => (id, email),
        _ => return Err(AppError::Forbidden),
    };
    match crate::notification_email::send_test_email(pool, user_id, &email).await {
        Ok(log_id) => Ok(Json(TestEmailResponse {
            delivered: true,
            log_id: Some(log_id),
            recipient: email,
            error: None,
        })),
        Err(msg) => Ok(Json(TestEmailResponse {
            delivered: false,
            log_id: None,
            recipient: email,
            error: Some(msg),
        })),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestEmailResponse {
    pub delivered: bool,
    pub log_id: Option<i64>,
    pub recipient: String,
    pub error: Option<String>,
}

/// v1.4 W17: manually trigger the digest worker for the current user.
/// Useful for the dashboard's "Run digest now" button — operators see
/// the digest hit their inbox without waiting for the next tick.
pub async fn run_digest_now(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<RunDigestResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    // Re-zero this user's last_sent_at so the worker tick considers
    // them due, then drive one tick synchronously.
    let _ = sqlx::query(
        "UPDATE digest_runs SET last_sent_at = NULL WHERE user_id = $1",
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(format!("reset digest: {e}")))?;
    let daily_utc_hour: u8 = std::env::var("SENTORI_DIGEST_DAILY_HOUR")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|h: &u8| *h < 24)
        .unwrap_or(9);
    let sent = crate::notification_digest::run_once(pool, daily_utc_hour)
        .await
        .map_err(|e| AppError::Internal(format!("digest run: {e}")))?;
    Ok(Json(RunDigestResponse { sent }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDigestResponse {
    pub sent: u32,
}

pub async fn put_preferences(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Json(body): Json<PreferencesPatch>,
) -> Result<Json<NotificationPreferences>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let user_id = match caller {
        AdminCaller::User { id, .. } => id,
        _ => return Err(AppError::Forbidden),
    };
    if !ALLOWED_CADENCES.contains(&body.cadence.as_str()) {
        return Err(AppError::Internal(format!(
            "invalid cadence '{}'; allowed: {ALLOWED_CADENCES:?}",
            body.cadence
        )));
    }
    for c in &body.channels {
        if !ALLOWED_CHANNELS.contains(&c.as_str()) {
            return Err(AppError::Internal(format!(
                "invalid channel '{c}'; allowed: {ALLOWED_CHANNELS:?}"
            )));
        }
    }
    for k in &body.muted_kinds {
        if !KNOWN_KINDS.contains(&k.as_str()) {
            return Err(AppError::Internal(format!(
                "unknown mute kind '{k}'; allowed: {KNOWN_KINDS:?}"
            )));
        }
    }
    let mut muted = body.muted_kinds.clone();
    muted.sort();
    muted.dedup();
    let row: NotificationPreferences = sqlx::query_as(
        r#"
        INSERT INTO notification_preferences (user_id, muted_kinds, cadence, channels)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE SET
            muted_kinds = EXCLUDED.muted_kinds,
            cadence     = EXCLUDED.cadence,
            channels    = EXCLUDED.channels,
            updated_at  = now()
        RETURNING muted_kinds, cadence, channels
        "#,
    )
    .bind(user_id)
    .bind(&muted)
    .bind(&body.cadence)
    .bind(&body.channels)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(format!("put_preferences: {e}")))?;
    Ok(Json(row))
}
