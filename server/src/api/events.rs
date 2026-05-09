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
        if let Err(e) = persist_event(pool, state.project_id, &event).await {
            tracing::error!(error = %e, "failed to persist event");
        }
    }

    state.recent.push(event);

    Ok(StatusCode::ACCEPTED)
}

pub(crate) async fn persist_event(
    pool: &PgPool,
    project_id: Uuid,
    event: &Event,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_value(event)
        .expect("Event serialization should never fail");

    sqlx::query(
        r#"
        INSERT INTO events
            (id, project_id, occurred_at, platform, release, environment,
             error_type, error_message, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(event.id)
    .bind(project_id)
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
