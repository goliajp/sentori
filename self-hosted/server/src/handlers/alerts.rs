//! /v1/alerts — K14 alert rule CRUD.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use sentori_alert_rule::{AlertRuleDraft, AlertRulePatch, TriggerKind};
use sentori_workspace_identity::ProjectId;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Serialize)]
pub struct AlertRuleRow {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub enabled: bool,
    pub muted: bool,
    pub trigger_kind: String,
    pub trigger_config: Value,
    pub filter_config: Value,
    pub channels: Value,
    pub throttle_minutes: i32,
    pub last_fired_at: Option<OffsetDateTime>,
    pub snoozed_until: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

fn to_row(r: sentori_alert_rule::AlertRule) -> AlertRuleRow {
    AlertRuleRow {
        id: r.id,
        project_id: r.project_id.map(sentori_workspace_identity::ProjectId::into_uuid),
        name: r.name,
        enabled: r.enabled,
        muted: r.muted,
        trigger_kind: r.trigger_kind.to_string(),
        trigger_config: r.trigger_config,
        filter_config: r.filter_config,
        channels: r.channels,
        throttle_minutes: r.throttle_minutes,
        last_fired_at: r.last_fired_at,
        snoozed_until: r.snoozed_until,
        created_at: r.created_at,
        updated_at: r.updated_at,
    }
}

pub async fn list_workspace(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<AlertRuleRow>>, (StatusCode, String)> {
    let rules = state
        .alerts
        .list_workspace_wide()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rules.into_iter().map(to_row).collect()))
}

pub async fn list_for_project(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<Uuid>,
) -> Result<Json<Vec<AlertRuleRow>>, (StatusCode, String)> {
    let rules = state
        .alerts
        .list_for_project(ProjectId::from_uuid(project_id))
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(rules.into_iter().map(to_row).collect()))
}

#[derive(Deserialize)]
pub struct CreateBody {
    pub name: String,
    pub trigger_kind: String, // "new_issue" / "regression" / "event_count" / "crash_free_drop"
    pub project_id: Option<Uuid>,
    #[serde(default)]
    pub trigger_config: Option<Value>,
    #[serde(default)]
    pub filter_config: Option<Value>,
    #[serde(default)]
    pub channels: Option<Value>,
    #[serde(default = "default_throttle")]
    pub throttle_minutes: i32,
}

fn default_throttle() -> i32 {
    10
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, String)> {
    let kind = TriggerKind::from_db_str(&body.trigger_kind)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    let mut draft = AlertRuleDraft::new(state.workspace_id, &body.name, kind)
        .with_throttle(body.throttle_minutes);
    if let Some(pid) = body.project_id {
        draft = draft.for_project(ProjectId::from_uuid(pid));
    }
    if let Some(c) = body.trigger_config {
        draft = draft.with_trigger_config(c);
    }
    if let Some(c) = body.filter_config {
        draft = draft.with_filter(c);
    }
    if let Some(c) = body.channels {
        draft = draft.with_channels(c);
    }
    let id = state
        .alerts
        .create_rule(draft)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({"id": id}))))
}

#[derive(Deserialize, Default)]
pub struct PatchBody {
    pub name: Option<String>,
    pub trigger_config: Option<Value>,
    pub filter_config: Option<Value>,
    pub channels: Option<Value>,
    pub throttle_minutes: Option<i32>,
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchBody>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .alerts
        .update(
            id,
            AlertRulePatch {
                name: body.name,
                trigger_config: body.trigger_config,
                filter_config: body.filter_config,
                channels: body.channels,
                throttle_minutes: body.throttle_minutes,
            },
        )
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, String)> {
    state
        .alerts
        .delete(id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let rule = state
        .alerts
        .find(id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "alert_rule not found".to_string()))?;
    Ok(Json(serde_json::json!({
        "id": rule.id.to_string(),
        "project_id": rule.project_id.map(|u| u.to_string()),
        "name": rule.name,
        "enabled": rule.enabled,
        "trigger_kind": format!("{:?}", rule.trigger_kind),
        "trigger_config": rule.trigger_config,
        "filter_config": rule.filter_config,
        "channels": rule.channels,
        "throttle_minutes": rule.throttle_minutes,
        "last_fired_at": rule.last_fired_at,
        "muted": rule.muted,
        "snoozed_until": rule.snoozed_until,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    })))
}
