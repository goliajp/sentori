// Phase 13 sub-section G (回填 Phase 9 deferred): notification_recipients CRUD.
// All endpoints sit under /admin/api/projects/{project_id}/recipients and
// inherit the require_admin + require_project_in_org middleware stack.

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::recent::AppState;

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct RecipientRow {
    id: Uuid,
    email: String,
    on_new_issue: bool,
    on_regression: bool,
    created_at: OffsetDateTime,
}

pub async fn list_recipients(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => return server_error("dbNotConfigured"),
    };
    let rows: Vec<RecipientRow> = sqlx::query_as(
        "SELECT id, email, on_new_issue, on_regression, created_at \
         FROM notification_recipients WHERE project_id = $1 \
         ORDER BY created_at",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRecipientBody {
    pub email: String,
    #[serde(default = "default_true")]
    pub on_new_issue: bool,
    #[serde(default)]
    pub on_regression: bool,
}

fn default_true() -> bool {
    true
}

pub async fn create_recipient(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateRecipientBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => return server_error("dbNotConfigured"),
    };
    let email = body.email.trim().to_ascii_lowercase();
    if email.is_empty() || !email.contains('@') {
        return bad_request("invalidEmail");
    }

    let id = Uuid::now_v7();
    let result = sqlx::query(
        "INSERT INTO notification_recipients \
         (id, project_id, email, on_new_issue, on_regression) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(project_id)
    .bind(&email)
    .bind(body.on_new_issue)
    .bind(body.on_regression)
    .execute(pool)
    .await;

    match result {
        Ok(_) => (
            StatusCode::CREATED,
            Json(json!({
                "id": id,
                "email": email,
                "onNewIssue": body.on_new_issue,
                "onRegression": body.on_regression,
            })),
        )
            .into_response(),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => conflict("emailAlreadyAdded"),
        Err(e) => {
            tracing::error!(error = %e, "insert recipient failed");
            server_error("insertFailed")
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRecipientBody {
    #[serde(default)]
    pub on_new_issue: Option<bool>,
    #[serde(default)]
    pub on_regression: Option<bool>,
}

pub async fn patch_recipient(
    State(state): State<AppState>,
    Path((project_id, recipient_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<PatchRecipientBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => return server_error("dbNotConfigured"),
    };

    let result = sqlx::query(
        "UPDATE notification_recipients \
         SET on_new_issue = COALESCE($1, on_new_issue), \
             on_regression = COALESCE($2, on_regression) \
         WHERE id = $3 AND project_id = $4",
    )
    .bind(body.on_new_issue)
    .bind(body.on_regression)
    .bind(recipient_id)
    .bind(project_id)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() == 0 => not_found("recipientNotFound"),
        Ok(_) => ok_response(),
        Err(e) => {
            tracing::error!(error = %e, "patch recipient failed");
            server_error("updateFailed")
        }
    }
}

pub async fn delete_recipient(
    State(state): State<AppState>,
    Path((project_id, recipient_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => return server_error("dbNotConfigured"),
    };

    let result = sqlx::query(
        "DELETE FROM notification_recipients WHERE id = $1 AND project_id = $2",
    )
    .bind(recipient_id)
    .bind(project_id)
    .execute(pool)
    .await;

    match result {
        Ok(r) if r.rows_affected() == 0 => not_found("recipientNotFound"),
        Ok(_) => ok_response(),
        Err(e) => {
            tracing::error!(error = %e, "delete recipient failed");
            server_error("deleteFailed")
        }
    }
}

fn ok_response() -> Response {
    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}
fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}
fn conflict(error: &str) -> Response {
    (StatusCode::CONFLICT, Json(json!({ "error": error }))).into_response()
}
fn not_found(error: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": error }))).into_response()
}
fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}
