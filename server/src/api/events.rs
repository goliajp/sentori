use axum::{
    extract::{Json, State},
    http::StatusCode,
};
use validator::Validate;

use crate::error::AppError;
use crate::event::Event;
use crate::recent::RecentBuffer;

pub async fn handle(
    State(recent): State<RecentBuffer>,
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

    recent.push(event);

    Ok(StatusCode::ACCEPTED)
}
