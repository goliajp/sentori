//! Endpoint probe admin endpoints — synthetic HTTP monitor CRUD.
//!
//! GET    /admin/api/projects/:project_id/endpoint-probes — list
//! POST   /admin/api/projects/:project_id/endpoint-probes — create
//! PATCH  /admin/api/endpoint-probes/:probe_id (toggle enabled)
//! DELETE /admin/api/endpoint-probes/:probe_id

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tracing::{info, warn};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBody {
    pub endpoint_url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub expected_status: Option<i32>,
    #[serde(default)]
    pub interval_sec: Option<i32>,
    #[serde(default)]
    pub timeout_ms: Option<i32>,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateBody>,
) -> (StatusCode, Json<Value>) {
    if body.endpoint_url.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "endpoint_url required" })),
        );
    }
    let id = Uuid::now_v7();
    let result = sqlx::query(
        "INSERT INTO endpoint_probes (id, workspace_id, project_id, endpoint_url, method, \
            expected_status, interval_sec, timeout_ms, headers, enabled) \
         SELECT $1, p.workspace_id, $2, $3, $4, $5, $6, $7, '{}'::jsonb, TRUE \
         FROM projects p WHERE p.id = $2 \
         RETURNING id",
    )
    .bind(id)
    .bind(project_id)
    .bind(&body.endpoint_url)
    .bind(body.method.as_deref().unwrap_or("GET"))
    .bind(body.expected_status.unwrap_or(200))
    .bind(body.interval_sec.unwrap_or(60))
    .bind(body.timeout_ms.unwrap_or(5000))
    .fetch_optional(&state.pool)
    .await;
    match result {
        Ok(Some(row)) => {
            let id: Uuid = row.get("id");
            info!(%project_id, url = %body.endpoint_url, "admin.endpoint_probes created");
            (StatusCode::CREATED, Json(json!({ "id": id.to_string() })))
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "project_not_found" })),
        ),
        Err(e) => {
            warn!(error = %e, "admin.endpoint_probes create_failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
) -> Json<Value> {
    let rows = sqlx::query(
        "SELECT id, endpoint_url, method, expected_status, interval_sec, timeout_ms, \
                enabled, created_at \
         FROM endpoint_probes WHERE project_id = $1 ORDER BY created_at DESC",
    )
    .bind(project_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let out: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id").to_string(),
                "endpoint_url": r.get::<String, _>("endpoint_url"),
                "method": r.get::<String, _>("method"),
                "expected_status": r.get::<i32, _>("expected_status"),
                "interval_sec": r.get::<i32, _>("interval_sec"),
                "timeout_ms": r.get::<i32, _>("timeout_ms"),
                "enabled": r.get::<bool, _>("enabled"),
                "created_at": r.get::<time::OffsetDateTime, _>("created_at"),
            })
        })
        .collect();
    Json(json!({ "probes": out }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchBody {
    pub enabled: Option<bool>,
}

pub async fn patch(
    State(state): State<Arc<AppState>>,
    Path(probe_id): Path<Uuid>,
    Json(body): Json<PatchBody>,
) -> StatusCode {
    if let Some(en) = body.enabled {
        let _ = sqlx::query(
            "UPDATE endpoint_probes SET enabled = $1 WHERE id = $2",
        )
        .bind(en)
        .bind(probe_id)
        .execute(&state.pool)
        .await;
    }
    StatusCode::NO_CONTENT
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(probe_id): Path<Uuid>,
) -> StatusCode {
    let _ = sqlx::query("DELETE FROM endpoint_probes WHERE id = $1")
        .bind(probe_id)
        .execute(&state.pool)
        .await;
    StatusCode::NO_CONTENT
}
