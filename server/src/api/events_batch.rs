use axum::{extract::Json, http::StatusCode, response::IntoResponse};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::error::{ValidationDetail, flatten_validation_errors};
use crate::event::Event;

const MAX_BATCH_EVENTS: usize = 100;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchRequest {
    pub events: Vec<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResponse {
    pub accepted: u32,
    pub rejected: u32,
    pub errors: Vec<BatchError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchError {
    pub index: u32,
    pub error: &'static str,
    pub details: Vec<ValidationDetail>,
}

pub async fn handle(Json(req): Json<BatchRequest>) -> impl IntoResponse {
    if req.events.len() > MAX_BATCH_EVENTS {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "tooManyEvents" })),
        )
            .into_response();
    }

    let mut accepted = 0u32;
    let mut rejected = 0u32;
    let mut errors = Vec::new();

    for (i, raw) in req.events.into_iter().enumerate() {
        match serde_json::from_value::<Event>(raw) {
            Ok(event) => match event.validate() {
                Ok(()) => {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&event)
                            .unwrap_or_else(|_| "<failed to serialize>".into())
                    );
                    accepted += 1;
                }
                Err(e) => {
                    rejected += 1;
                    errors.push(BatchError {
                        index: i as u32,
                        error: "validationFailed",
                        details: flatten_validation_errors(&e),
                    });
                }
            },
            Err(e) => {
                rejected += 1;
                errors.push(BatchError {
                    index: i as u32,
                    error: "invalidJson",
                    details: vec![ValidationDetail {
                        field: "<root>".into(),
                        message: e.to_string(),
                    }],
                });
            }
        }
    }

    (
        StatusCode::ACCEPTED,
        Json(BatchResponse {
            accepted,
            rejected,
            errors,
        }),
    )
        .into_response()
}
