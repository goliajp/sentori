//! GET /healthz — liveness + control-plane DB ping.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
pub struct Health {
    status: &'static str,
    control_plane_db: &'static str,
    version: &'static str,
}

pub async fn healthz(State(state): State<Arc<AppState>>) -> (StatusCode, Json<Health>) {
    let db = match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => "ok",
        Err(_) => "down",
    };
    let code = if db == "ok" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        code,
        Json(Health {
            status: if db == "ok" { "ok" } else { "degraded" },
            control_plane_db: db,
            version: env!("CARGO_PKG_VERSION"),
        }),
    )
}
