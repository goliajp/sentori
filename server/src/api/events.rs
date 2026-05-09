use axum::{
    extract::{Json, State},
    http::StatusCode,
};
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::error::AppError;
use crate::event::Event;
use crate::recent::AppState;

pub async fn handle(
    State(state): State<AppState>,
    Json(event): Json<Event>,
) -> Result<StatusCode, AppError> {
    event.validate().map_err(AppError::Validation)?;

    tracing::info!(
        event_id = %event.id,
        platform = ?event.platform,
        error_type = %event.error.r#type,
        "event accepted"
    );

    println!(
        "{}",
        serde_json::to_string_pretty(&event)
            .unwrap_or_else(|_| "<failed to serialize>".into())
    );

    if let Some(pool) = &state.db {
        if let Err(e) = persist_with_grouping(pool, state.project_id, &event).await {
            tracing::error!(error = %e, "failed to persist event");
        }
    }

    state.recent.push(event);

    Ok(StatusCode::ACCEPTED)
}

/// Compute fingerprint, upsert the issue, then insert the event row
/// linked to that issue.
pub(crate) async fn persist_with_grouping(
    pool: &PgPool,
    project_id: Uuid,
    event: &Event,
) -> Result<(), sqlx::Error> {
    let fp = crate::grouping::fingerprint(event);
    let issue_id = crate::issues::upsert_issue(pool, project_id, &fp, event).await?;
    persist_event_row(pool, project_id, event, Some(issue_id)).await
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
        ON CONFLICT (id) DO NOTHING
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
