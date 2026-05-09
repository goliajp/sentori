use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::api::events::{caller_project_id, persist_with_grouping};
use crate::auth::IngestCaller;
use crate::error::{ValidationDetail, flatten_validation_errors};
use crate::event::Event;
use crate::quotas::{self, QuotaDecision};
use crate::recent::AppState;

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

pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(req): Json<BatchRequest>,
) -> impl IntoResponse {
    if req.events.len() > MAX_BATCH_EVENTS {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "tooManyEvents" })),
        )
            .into_response();
    }

    let project_id = caller_project_id(&caller, &state);
    let mut accepted = 0u32;
    let mut rejected = 0u32;
    let mut errors = Vec::new();

    for (i, raw) in req.events.into_iter().enumerate() {
        match serde_json::from_value::<Event>(raw) {
            Ok(event) => match event.validate() {
                Ok(()) => {
                    if !batch_quota_allows(&state, &caller).await {
                        rejected += 1;
                        errors.push(BatchError {
                            index: i as u32,
                            error: "quotaExceeded",
                            details: vec![],
                        });
                        continue;
                    }
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

/// Batch entries are quota-checked one at a time so a single over-the-line
/// batch admits only what fits and rejects the rest. DevToken / no-Valkey
/// configurations skip the gate (fail-open, mirrors single-event handler).
async fn batch_quota_allows(state: &AppState, caller: &IngestCaller) -> bool {
    let (org_id, pool, valkey) = match (caller, &state.db, &state.valkey) {
        (IngestCaller::Token { org_id, .. }, Some(p), Some(v)) => (*org_id, p, v),
        _ => return true,
    };
    match quotas::check_and_record(
        pool,
        valkey.clone(),
        org_id,
        time::OffsetDateTime::now_utc(),
    )
    .await
    {
        Ok(QuotaDecision::Allowed { .. }) => true,
        Ok(QuotaDecision::Exceeded { .. }) => false,
        Err(e) => {
            tracing::error!(error = %e, "batch quota check failed; admitting");
            true
        }
    }
}
