//! GET /v1/usage — K17 workspace-wide billing usage panel.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sentori_billing::{Plan, period_key};
use serde::Serialize;
use time::OffsetDateTime;

use crate::state::AppState;

#[derive(Serialize)]
pub struct UsageResponse {
    pub plan: String,
    pub status: String,
    pub period_yyyymm: String,
    pub events: CounterTotal,
    pub spans: CounterTotal,
    pub replays: CounterTotal,
}

#[derive(Serialize)]
pub struct CounterTotal {
    pub count: i64,
    pub dropped: i64,
    pub limit: i64,
}

pub async fn current(
    State(state): State<Arc<AppState>>,
) -> Result<Json<UsageResponse>, (StatusCode, String)> {
    let billing = state
        .billing
        .get()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let limits = billing.plan.limits();
    let now = OffsetDateTime::now_utc();
    let period = period_key(now);

    let rows = state
        .billing
        .workspace_usage(&period)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut events = 0i64;
    let mut spans = 0i64;
    let mut replays = 0i64;
    let mut events_dropped = 0i64;
    let mut spans_dropped = 0i64;
    let mut replays_dropped = 0i64;
    for (kind, count, dropped) in rows {
        match kind {
            sentori_billing::CounterKind::Events => {
                events = count;
                events_dropped = dropped;
            }
            sentori_billing::CounterKind::Spans => {
                spans = count;
                spans_dropped = dropped;
            }
            sentori_billing::CounterKind::Replays => {
                replays = count;
                replays_dropped = dropped;
            }
        }
    }

    Ok(Json(UsageResponse {
        plan: plan_str(billing.plan).into(),
        status: billing.status.to_string(),
        period_yyyymm: period,
        events: CounterTotal {
            count: events,
            dropped: events_dropped,
            limit: limits.events_monthly,
        },
        spans: CounterTotal {
            count: spans,
            dropped: spans_dropped,
            limit: limits.spans_monthly,
        },
        replays: CounterTotal {
            count: replays,
            dropped: replays_dropped,
            limit: limits.replays_monthly,
        },
    }))
}

const fn plan_str(plan: Plan) -> &'static str {
    plan.as_db_str()
}
