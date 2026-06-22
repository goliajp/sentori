//! GET /v1/audit — K13 audit log query.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use sentori_audit_event::AuditQuery;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize, Default)]
pub struct ListQuery {
    pub project_id: Option<Uuid>,
    pub actor_user_id: Option<Uuid>,
    pub action: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Serialize)]
pub struct AuditRow {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub actor_user_id: Option<Uuid>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub payload: Value,
    pub created_at: OffsetDateTime,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Vec<AuditRow>>, (StatusCode, String)> {
    let mut aq = AuditQuery::default().with_limit(q.limit.unwrap_or(100));
    if let Some(pid) = q.project_id {
        aq = aq.with_project(sentori_workspace_identity::ProjectId::from_uuid(pid));
    }
    if let Some(uid) = q.actor_user_id {
        aq = aq.with_actor(sentori_workspace_identity::UserId::from_uuid(uid));
    }
    if let Some(action) = q.action {
        aq = aq.with_action(action);
    }
    let entries = state
        .audit
        .query(aq)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        entries
            .into_iter()
            .map(|e| AuditRow {
                id: e.id,
                project_id: e.project_id.map(|p| p.into_uuid()),
                actor_user_id: e.actor_user_id.map(|u| u.into_uuid()),
                action: e.action,
                target_type: e.target_type,
                target_id: e.target_id,
                payload: e.payload,
                created_at: e.created_at,
            })
            .collect(),
    ))
}
