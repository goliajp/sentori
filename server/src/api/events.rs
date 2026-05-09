use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
};
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::auth::IngestCaller;
use crate::error::AppError;
use crate::event::Event;
use crate::recent::AppState;

pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(event): Json<Event>,
) -> Result<StatusCode, AppError> {
    event.validate().map_err(AppError::Validation)?;

    let project_id = caller_project_id(&caller, &state);

    tracing::info!(
        event_id = %event.id,
        platform = ?event.platform,
        error_type = %event.error.r#type,
        %project_id,
        "event accepted"
    );

    println!(
        "{}",
        serde_json::to_string_pretty(&event)
            .unwrap_or_else(|_| "<failed to serialize>".into())
    );

    if state.db.is_some() {
        if let Err(e) = persist_with_grouping(&state, project_id, &event).await {
            tracing::error!(error = %e, "failed to persist event");
        }
    }

    state.recent.push(event);

    Ok(StatusCode::ACCEPTED)
}

/// DB-backed tokens carry their project_id; the dev token is single-
/// tenant and falls back to AppState.project_id (the seeded dev row).
pub(crate) fn caller_project_id(caller: &IngestCaller, state: &AppState) -> Uuid {
    match caller {
        IngestCaller::Token { project_id } => *project_id,
        IngestCaller::DevToken => state.project_id,
    }
}

/// Compute fingerprint, upsert the issue, insert the event row linked
/// to that issue, and (if the upsert was an INSERT, not a conflict)
/// enqueue a NewIssue notification. Caller must ensure `state.db` is
/// Some.
pub(crate) async fn persist_with_grouping(
    state: &AppState,
    project_id: Uuid,
    event: &Event,
) -> Result<(), sqlx::Error> {
    let pool = state.db.as_ref().expect("persist_with_grouping requires db");
    let fp = crate::grouping::fingerprint(event);
    let (issue_id, is_new) =
        crate::issues::upsert_issue(pool, project_id, &fp, event).await?;
    persist_event_row(pool, project_id, event, Some(issue_id)).await?;

    if is_new {
        if let Some(tx) = &state.notifier_tx {
            let _ = tx.try_send(crate::notifier::NotifyEvent::NewIssue {
                project_id,
                issue_id,
                error_type: event.error.r#type.clone(),
                message: event.error.message.clone(),
            });
        }
    }

    Ok(())
}

async fn persist_event_row(
    pool: &PgPool,
    project_id: Uuid,
    event: &Event,
    issue_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_value(event)
        .expect("Event serialization should never fail");

    sqlx::query(
        r#"
        INSERT INTO events
            (id, project_id, issue_id, occurred_at, platform, release, environment,
             error_type, error_message, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(event.id)
    .bind(project_id)
    .bind(issue_id)
    .bind(event.timestamp)
    .bind(event.platform.as_str())
    .bind(&event.release)
    .bind(&event.environment)
    .bind(&event.error.r#type)
    .bind(&event.error.message)
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(())
}
