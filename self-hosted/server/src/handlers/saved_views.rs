//! /v1/saved-views — K15 saved view CRUD.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use sentori_saved_view::{SavedViewDraft, Scope, Target};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct ListQuery {
    pub target: String, // "issues" / "events" / "spans" / "replays" / "metrics"
    pub project_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct ViewRow {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub target: String,
    pub scope: String,
    pub name: String,
    pub payload: Value,
    pub created_at: OffsetDateTime,
}

pub async fn list_workspace(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<ViewRow>>, (StatusCode, String)> {
    let target = Target::from_db_str(&q.target)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let views = state
        .saved_views
        .list_workspace(target)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        views
            .into_iter()
            .map(|v| ViewRow {
                id: v.id,
                project_id: v.project_id.map(|p| p.into_uuid()),
                target: v.target.to_string(),
                scope: v.scope.to_string(),
                name: v.name,
                payload: v.payload,
                created_at: v.created_at,
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct CreateBody {
    pub name: String,
    pub target: String,
    pub project_id: Option<Uuid>,
    #[serde(default)]
    pub payload: Option<Value>,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, String)> {
    let target = Target::from_db_str(&body.target)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut draft = SavedViewDraft::new(state.workspace_id, &body.name, target, Scope::Workspace);
    if let Some(pid) = body.project_id {
        draft = draft.for_project(sentori_workspace_identity::ProjectId::from_uuid(pid));
    }
    if let Some(p) = body.payload {
        draft = draft.with_payload(p);
    }
    let id = state
        .saved_views
        .create(draft)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({"id": id}))))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .saved_views
        .delete(id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
