//! Project CRUD (superadmin) — design.md §9.

use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tracing::warn;
use uuid::Uuid;

use crate::session_mw::SessionContext;
use crate::state::AppState;

fn superadmin_only(ctx: &SessionContext) -> Result<(), (StatusCode, Json<Value>)> {
    if ctx.role.is_superadmin() {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "superadmin_only" })),
        ))
    }
}

#[derive(Deserialize)]
pub struct CreateBody {
    pub name: String,
    #[serde(default)]
    pub platform: Option<String>,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Json(body): Json<CreateBody>,
) -> (StatusCode, Json<Value>) {
    if let Err(e) = superadmin_only(&ctx) {
        return e;
    }
    let id = Uuid::now_v7();
    let platform = body.platform.unwrap_or_else(|| "react-native".to_string());
    match sqlx::query("INSERT INTO projects (id, name, platform) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(&body.name)
        .bind(&platform)
        .execute(&state.pool)
        .await
    {
        Ok(_) => {
            crate::audit::record(
                &state.pool,
                Some(id),
                ctx.user_id,
                "project.create",
                "project",
                &id.to_string(),
                json!({ "name": body.name }),
            )
            .await;
            (
                StatusCode::CREATED,
                Json(json!({ "id": id, "name": body.name, "platform": platform })),
            )
        }
        Err(e) => {
            warn!(error = %e, "project create failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path(project_id): Path<Uuid>,
) -> (StatusCode, Json<Value>) {
    if let Err(e) = super::tokens::ensure_project_access(&state, &ctx, project_id).await {
        return e;
    }
    let row: Option<(String, String, time::OffsetDateTime)> =
        sqlx::query_as("SELECT name, platform, created_at FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_optional(&state.pool)
            .await
            .unwrap_or(None);
    match row {
        Some((name, platform, created_at)) => (
            StatusCode::OK,
            Json(json!({
                "id": project_id,
                "name": name,
                "platform": platform,
                "createdAt": crate::wire_time::rfc3339(created_at),
            })),
        ),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "project_not_found" })),
        ),
    }
}

#[derive(Deserialize)]
pub struct UpdateBody {
    pub name: Option<String>,
    pub platform: Option<String>,
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<UpdateBody>,
) -> (StatusCode, Json<Value>) {
    if let Err(e) = superadmin_only(&ctx) {
        return e;
    }
    let r = sqlx::query(
        "UPDATE projects SET name = COALESCE($2, name), platform = COALESCE($3, platform) \
         WHERE id = $1",
    )
    .bind(project_id)
    .bind(body.name.as_deref())
    .bind(body.platform.as_deref())
    .execute(&state.pool)
    .await;
    match r {
        Ok(res) if res.rows_affected() > 0 => {
            crate::audit::record(
                &state.pool,
                Some(project_id),
                ctx.user_id,
                "project.update",
                "project",
                &project_id.to_string(),
                json!({ "name": body.name, "platform": body.platform }),
            )
            .await;
            (StatusCode::OK, Json(json!({ "ok": true })))
        }
        Ok(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "project_not_found" })),
        ),
        Err(e) => {
            warn!(error = %e, "project update failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path(project_id): Path<Uuid>,
) -> (StatusCode, Json<Value>) {
    if let Err(e) = superadmin_only(&ctx) {
        return e;
    }
    let r = sqlx::query("DELETE FROM projects WHERE id = $1")
        .bind(project_id)
        .execute(&state.pool)
        .await;
    match r {
        Ok(res) if res.rows_affected() > 0 => {
            crate::audit::record(
                &state.pool,
                None,
                ctx.user_id,
                "project.delete",
                "project",
                &project_id.to_string(),
                json!({}),
            )
            .await;
            (StatusCode::OK, Json(json!({ "ok": true })))
        }
        Ok(_) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "project_not_found" })),
        ),
        Err(e) => {
            warn!(error = %e, "project delete failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        }
    }
}
