// Phase 27 sub-A: alert rules CRUD.
//
// Org-scoped routes under `/api/orgs/{slug}/alert-rules`. The server
// layer doesn't validate trigger_config / filter_config / channels
// shape beyond top-level types — sub-B's evaluator owns that. Reason:
// shapes will grow (mute / snooze in sub-F, more trigger kinds in
// later releases) and locking them at the DB / API layer would force
// migrations for every shape tweak.
//
// Authz mirrors saved_views (Phase 24 sub-C):
//   - read: any org member
//   - create / update / delete: owner / admin
// Audit rows land for create / update / delete so the trail covers
// "who armed the rule that paged us at 3am".

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value as JsonValue, json};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::teams::resolve_membership;
use crate::api::user_auth::CurrentUser;
use crate::recent::AppState;

const VALID_TRIGGERS: &[&str] = &["new_issue", "regression", "event_count", "crash_free_drop"];
const NAME_MIN: usize = 1;
const NAME_MAX: usize = 80;
const THROTTLE_MAX: i32 = 7 * 24 * 60; // 1 week

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AlertRuleRow {
    pub id: Uuid,
    pub org_id: Uuid,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub enabled: bool,
    pub trigger_kind: String,
    pub trigger_config: JsonValue,
    pub filter_config: JsonValue,
    pub channels: JsonValue,
    pub throttle_minutes: i32,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub last_fired_at: Option<OffsetDateTime>,
    // Phase 27 sub-F: mute / snooze.
    pub muted: bool,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub snoozed_until: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub created_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

pub async fn list_rules(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let (org_id, _role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };

    let rows: Vec<AlertRuleRow> = sqlx::query_as(
        "SELECT id, org_id, project_id, name, enabled, trigger_kind, \
                trigger_config, filter_config, channels, throttle_minutes, \
                last_fired_at, muted, snoozed_until, \
                created_at, created_by, updated_at \
         FROM alert_rules WHERE org_id = $1 \
         ORDER BY created_at",
    )
    .bind(org_id)
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRuleBody {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub project_id: Option<Uuid>,
    pub trigger_kind: String,
    #[serde(default = "default_object")]
    pub trigger_config: JsonValue,
    #[serde(default = "default_object")]
    pub filter_config: JsonValue,
    #[serde(default = "default_array")]
    pub channels: JsonValue,
    #[serde(default = "default_throttle")]
    pub throttle_minutes: i32,
}

fn default_enabled() -> bool {
    true
}
fn default_object() -> JsonValue {
    json!({})
}
fn default_array() -> JsonValue {
    json!([])
}
fn default_throttle() -> i32 {
    10
}

pub async fn create_rule(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path(slug): Path<String>,
    Json(body): Json<CreateRuleBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return forbidden("notOrgAdmin");
    }

    let trimmed = body.name.trim();
    let len = trimmed.chars().count();
    if len < NAME_MIN || len > NAME_MAX {
        return bad_request("invalidName");
    }
    if !VALID_TRIGGERS.contains(&body.trigger_kind.as_str()) {
        return bad_request("invalidTriggerKind");
    }
    if !body.filter_config.is_object() || !body.trigger_config.is_object() {
        return bad_request("invalidConfig");
    }
    if !body.channels.is_array() {
        return bad_request("invalidChannels");
    }
    if body.throttle_minutes < 0 || body.throttle_minutes > THROTTLE_MAX {
        return bad_request("invalidThrottle");
    }
    if let Some(pid) = body.project_id {
        // Ensure the project actually belongs to this org.
        let exists: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM projects WHERE id = $1 AND org_id = $2",
        )
        .bind(pid)
        .bind(org_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
        if exists.is_none() {
            return bad_request("projectNotInOrg");
        }
    }

    let id = Uuid::now_v7();
    let res: Result<(), sqlx::Error> = sqlx::query(
        "INSERT INTO alert_rules \
            (id, org_id, project_id, name, enabled, trigger_kind, \
             trigger_config, filter_config, channels, throttle_minutes, created_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(id)
    .bind(org_id)
    .bind(body.project_id)
    .bind(trimmed)
    .bind(body.enabled)
    .bind(&body.trigger_kind)
    .bind(&body.trigger_config)
    .bind(&body.filter_config)
    .bind(&body.channels)
    .bind(body.throttle_minutes)
    .bind(user.id)
    .execute(&pool)
    .await
    .map(|_| ());
    if let Err(e) = res {
        tracing::error!(error = %e, "alert_rules insert failed");
        return server_error("insert");
    }

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        crate::audit::actions::ALERT_RULE_CREATED,
        crate::audit::targets::ALERT_RULE,
        Some(id),
        json!({ "name": trimmed, "trigger_kind": body.trigger_kind }),
    )
    .await;

    (StatusCode::CREATED, Json(json!({ "id": id }))).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PatchRuleBody {
    pub name: Option<String>,
    pub enabled: Option<bool>,
    pub trigger_config: Option<JsonValue>,
    pub filter_config: Option<JsonValue>,
    pub channels: Option<JsonValue>,
    pub throttle_minutes: Option<i32>,
    /// Phase 27 sub-F: explicit silence; only an unmute brings it back.
    pub muted: Option<bool>,
    /// Phase 27 sub-F: temporary silence (RFC 3339). Send `null` to
    /// clear the snooze early; omit to leave alone.
    #[serde(default, deserialize_with = "deserialize_double_option")]
    pub snoozed_until: Option<Option<OffsetDateTime>>,
}

fn deserialize_double_option<'de, T, D>(
    d: D,
) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

impl Default for PatchRuleBody {
    fn default() -> Self {
        Self {
            channels: None,
            enabled: None,
            filter_config: None,
            muted: None,
            name: None,
            snoozed_until: None,
            throttle_minutes: None,
            trigger_config: None,
        }
    }
}

pub async fn patch_rule(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((slug, id)): Path<(String, Uuid)>,
    Json(body): Json<PatchRuleBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return forbidden("notOrgAdmin");
    }

    let exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM alert_rules WHERE id = $1 AND org_id = $2")
            .bind(id)
            .bind(org_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    if exists.is_none() {
        return not_found("ruleNotFound");
    }

    if let Some(n) = &body.name {
        let len = n.trim().chars().count();
        if len < NAME_MIN || len > NAME_MAX {
            return bad_request("invalidName");
        }
    }
    if let Some(t) = &body.throttle_minutes {
        if *t < 0 || *t > THROTTLE_MAX {
            return bad_request("invalidThrottle");
        }
    }
    if let Some(c) = &body.channels {
        if !c.is_array() {
            return bad_request("invalidChannels");
        }
    }

    // For snoozed_until we use double-Option semantics: `None` means
    // "field not present"; `Some(None)` means "explicit null → clear".
    // SQL gets a single param + a "should we touch this column" flag
    // so the COALESCE trick still works for the unset case while
    // letting `Some(None)` write SQL NULL.
    let snooze_present = body.snoozed_until.is_some();
    let snooze_value = body.snoozed_until.as_ref().and_then(|o| o.as_ref()).cloned();

    let res: Result<u64, sqlx::Error> = sqlx::query(
        r#"
        UPDATE alert_rules SET
            name             = COALESCE($1, name),
            enabled          = COALESCE($2, enabled),
            trigger_config   = COALESCE($3, trigger_config),
            filter_config    = COALESCE($4, filter_config),
            channels         = COALESCE($5, channels),
            throttle_minutes = COALESCE($6, throttle_minutes),
            muted            = COALESCE($7, muted),
            snoozed_until    = CASE WHEN $8::BOOL THEN $9 ELSE snoozed_until END,
            updated_at       = now()
        WHERE id = $10 AND org_id = $11
        "#,
    )
    .bind(body.name.as_deref().map(str::trim))
    .bind(body.enabled)
    .bind(body.trigger_config.as_ref())
    .bind(body.filter_config.as_ref())
    .bind(body.channels.as_ref())
    .bind(body.throttle_minutes)
    .bind(body.muted)
    .bind(snooze_present)
    .bind(snooze_value)
    .bind(id)
    .bind(org_id)
    .execute(&pool)
    .await
    .map(|r| r.rows_affected());
    match res {
        Ok(n) if n > 0 => {}
        Ok(_) => return not_found("ruleNotFound"),
        Err(e) => {
            tracing::error!(error = %e, "alert_rules patch failed");
            return server_error("update");
        }
    }

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        crate::audit::actions::ALERT_RULE_PATCHED,
        crate::audit::targets::ALERT_RULE,
        Some(id),
        json!({}),
    )
    .await;

    (StatusCode::OK, Json(json!({ "ok": true }))).into_response()
}

pub async fn delete_rule(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((slug, id)): Path<(String, Uuid)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let (org_id, role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return forbidden("notOrgAdmin");
    }

    let res = sqlx::query("DELETE FROM alert_rules WHERE id = $1 AND org_id = $2")
        .bind(id)
        .bind(org_id)
        .execute(&pool)
        .await;
    match res {
        Ok(r) if r.rows_affected() > 0 => {}
        Ok(_) => return not_found("ruleNotFound"),
        Err(e) => {
            tracing::error!(error = %e, %id, "alert_rules delete failed");
            return server_error("delete");
        }
    }

    crate::audit::record(
        &pool,
        org_id,
        Some(user.id),
        crate::audit::actions::ALERT_RULE_DELETED,
        crate::audit::targets::ALERT_RULE,
        Some(id),
        json!({}),
    )
    .await;

    (StatusCode::NO_CONTENT, ()).into_response()
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryRow {
    pub id: Uuid,
    pub attempt: i32,
    pub status: String,
    pub last_status: Option<i32>,
    pub last_error: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub delivered_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub next_attempt_at: OffsetDateTime,
}

/// Phase 29 sub-B: last 10 webhook delivery attempts for a rule.
///
/// Org-scoped — any member of the rule's org can read; mirrors the
/// list_rules authz so the dashboard surface lines up with the rest of
/// the alerts page.
pub async fn list_deliveries(
    State(state): State<AppState>,
    Extension(user): Extension<CurrentUser>,
    Path((slug, rule_id)): Path<(String, Uuid)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };
    let (org_id, _role) = match resolve_membership(&pool, &slug, user.id).await {
        Some(m) => m,
        None => return not_found("orgNotFound"),
    };

    // Make sure the rule belongs to this org before we leak its
    // deliveries. (FK CASCADE means cross-org probes would otherwise
    // get an empty list, which is fine, but explicit 404 keeps the
    // shape consistent with patch / delete.)
    let owned: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM alert_rules WHERE id = $1 AND org_id = $2",
    )
    .bind(rule_id)
    .bind(org_id)
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();
    if owned.is_none() {
        return not_found("ruleNotFound");
    }

    let rows: Vec<WebhookDeliveryRow> = match sqlx::query_as(
        "SELECT id, attempt, status, last_status, last_error, \
                created_at, delivered_at, next_attempt_at \
         FROM webhook_deliveries \
         WHERE rule_id = $1 \
         ORDER BY created_at DESC \
         LIMIT 10",
    )
    .bind(rule_id)
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(_) => return server_error("queryFailed"),
    };

    (StatusCode::OK, Json(rows)).into_response()
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}
fn forbidden(error: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": error }))).into_response()
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
