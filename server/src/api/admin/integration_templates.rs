// v1.4 W23 — cross-org integration sharing / templating.
//
// The operator typically admins multiple orgs. v1.3 forced them to
// re-run an OAuth handshake for every org (or copy/paste PATs).
// W23 lets them save a configured integration as a "template" and
// re-apply it to other orgs in two clicks.
//
// Endpoints under `/admin/api/account/integration-templates`:
//
//   GET    /                        — list this user's templates +
//                                     templates shared with their orgs
//   POST   /                        — create a new template from a
//                                     given (kind, name, config)
//   PUT    /{id}                    — replace name / config / sharing
//   DELETE /{id}                    — remove
//   POST   /{id}/apply              — apply to a target org via the
//                                     existing per-org configure path
//
// Sharing model:
//   - `owner_user_id` is the creator. Templates default to private.
//   - `shared_with_org_id` (nullable) opts the template into visibility
//     for admins of that org. NULL = private to the owner.
//   - Reads include templates owned by the caller OR shared with any
//     org the caller is owner/admin of.
//   - Mutations (PUT/DELETE) are owner-only. Apply is allowed if
//     the caller can read the template AND is owner/admin of the
//     target org.

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::error::AppError;
use crate::api::integrations::adapter_for;
use crate::recent::AppState;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationTemplateRow {
    pub id: Uuid,
    pub kind: String,
    pub name: String,
    /// JSONB config. Returned verbatim to the owner only; non-owners
    /// see a sanitised view (see `list_templates` for the redaction).
    pub config: Value,
    pub owner_user_id: Uuid,
    pub owner_email: Option<String>,
    pub shared_with_org_id: Option<Uuid>,
    pub shared_with_org_slug: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateBody {
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub config: Value,
    /// Slug (not id) so the dashboard's form can submit it as a
    /// dropdown of "share with this org's admins". `None` =
    /// keep / set private.
    #[serde(default)]
    pub shared_with_org_slug: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyBody {
    pub target_org_slug: String,
}

// ── list ───────────────────────────────────────────────────────────

pub async fn list_templates(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
) -> Result<Json<Vec<IntegrationTemplateRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let caller_user_id = caller_user_id(&caller)?;
    let rows: Vec<IntegrationTemplateRow> = sqlx::query_as(
        r#"
        SELECT t.id, t.kind, t.name, t.config, t.owner_user_id,
               u.email AS owner_email, t.shared_with_org_id,
               so.slug AS shared_with_org_slug,
               t.created_at, t.updated_at
        FROM integration_templates t
        LEFT JOIN users u ON u.id = t.owner_user_id
        LEFT JOIN orgs so ON so.id = t.shared_with_org_id
        WHERE t.owner_user_id = $1
           OR (
                t.shared_with_org_id IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM memberships m
                    WHERE m.org_id = t.shared_with_org_id
                      AND m.user_id = $1
                      AND m.role IN ('owner', 'admin')
                )
           )
        ORDER BY t.updated_at DESC
        "#,
    )
    .bind(caller_user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("list templates: {e}")))?;

    // Non-owners get a redacted config: we strip OAuth secrets so
    // sharing a template doesn't accidentally hand a teammate an
    // access token. The apply path reads the full config out of the
    // owner's row so the redacted shape only affects the dashboard
    // list view.
    let redacted: Vec<IntegrationTemplateRow> = rows
        .into_iter()
        .map(|mut r| {
            if r.owner_user_id != caller_user_id {
                r.config = redact_config(&r.config);
            }
            r
        })
        .collect();
    Ok(Json(redacted))
}

// ── create ─────────────────────────────────────────────────────────

pub async fn create_template(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Json(body): Json<TemplateBody>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let caller_user_id = caller_user_id(&caller)?;
    validate_kind(&body.kind)?;
    let trimmed_name = body.name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Internal("template name required".into()));
    }

    let shared_org_id =
        resolve_shared_org_id(pool, caller_user_id, body.shared_with_org_slug.as_deref()).await?;

    let id = Uuid::now_v7();
    let row: IntegrationTemplateRow = sqlx::query_as(
        r#"
        INSERT INTO integration_templates
            (id, owner_user_id, kind, name, config, shared_with_org_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
            id, kind, name, config, owner_user_id,
            NULL::text AS owner_email,
            shared_with_org_id,
            NULL::text AS shared_with_org_slug,
            created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(caller_user_id)
    .bind(&body.kind)
    .bind(trimmed_name)
    .bind(&body.config)
    .bind(shared_org_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(format!("create template: {e}")))?;

    Ok((StatusCode::CREATED, Json(row)).into_response())
}

// ── update ─────────────────────────────────────────────────────────

pub async fn update_template(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(id): Path<Uuid>,
    Json(body): Json<TemplateBody>,
) -> Result<Json<IntegrationTemplateRow>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let caller_user_id = caller_user_id(&caller)?;
    validate_kind(&body.kind)?;
    let trimmed_name = body.name.trim();
    if trimmed_name.is_empty() {
        return Err(AppError::Internal("template name required".into()));
    }
    require_owner(pool, id, caller_user_id).await?;
    let shared_org_id =
        resolve_shared_org_id(pool, caller_user_id, body.shared_with_org_slug.as_deref()).await?;

    let row: IntegrationTemplateRow = sqlx::query_as(
        r#"
        UPDATE integration_templates
        SET kind = $1, name = $2, config = $3,
            shared_with_org_id = $4, updated_at = now()
        WHERE id = $5
        RETURNING
            id, kind, name, config, owner_user_id,
            NULL::text AS owner_email,
            shared_with_org_id,
            NULL::text AS shared_with_org_slug,
            created_at, updated_at
        "#,
    )
    .bind(&body.kind)
    .bind(trimmed_name)
    .bind(&body.config)
    .bind(shared_org_id)
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(format!("update template: {e}")))?;
    Ok(Json(row))
}

// ── delete ─────────────────────────────────────────────────────────

pub async fn delete_template(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let caller_user_id = caller_user_id(&caller)?;
    require_owner(pool, id, caller_user_id).await?;
    sqlx::query("DELETE FROM integration_templates WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(format!("delete template: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

// ── apply ──────────────────────────────────────────────────────────

pub async fn apply_template(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(id): Path<Uuid>,
    Json(body): Json<ApplyBody>,
) -> Result<Response, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let caller_user_id = caller_user_id(&caller)?;

    let row: Option<(String, Value, Uuid, Option<Uuid>)> = sqlx::query_as(
        "SELECT kind, config, owner_user_id, shared_with_org_id \
         FROM integration_templates WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("load template: {e}")))?;
    let Some((kind, config, owner_user_id, shared_with_org_id)) = row else {
        return Err(AppError::NotFound);
    };

    // Read permission: owner or member of the shared org. We don't
    // accept silent stripping here — the apply call needs the full
    // (non-redacted) config.
    if owner_user_id != caller_user_id {
        let Some(shared_org) = shared_with_org_id else {
            return Err(AppError::Forbidden);
        };
        let member: Option<(String,)> = sqlx::query_as(
            "SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2",
        )
        .bind(shared_org)
        .bind(caller_user_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| AppError::Internal(format!("check share access: {e}")))?;
        let Some((role,)) = member else {
            return Err(AppError::Forbidden);
        };
        if !matches!(role.as_str(), "owner" | "admin") {
            return Err(AppError::Forbidden);
        }
    }

    // Resolve + role-check the target org separately.
    let target: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT o.id, m.role FROM orgs o \
         JOIN memberships m ON m.org_id = o.id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(&body.target_org_slug)
    .bind(caller_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("resolve target org: {e}")))?;
    let Some((target_org_id, target_role)) = target else {
        return Err(AppError::NotFound);
    };
    if !matches!(target_role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden);
    }

    // Hand the stored config to the adapter's `accept_manual_config`
    // step — same path the per-org configure endpoint uses, so apply
    // either succeeds the same way a fresh configure would, or
    // surfaces the same validation error.
    let adapter = adapter_for(&kind).ok_or_else(|| AppError::Internal("unknown kind".into()))?;
    let cfg = adapter
        .accept_manual_config(config)
        .await
        .map_err(|e| AppError::Internal(format!("apply template invalidConfig: {e}")))?;

    crate::api::integrations::upsert_integration(pool, target_org_id, &kind, &cfg)
        .await
        .map_err(|e| AppError::Internal(format!("upsert integration: {e}")))?;

    crate::audit::record(
        pool,
        target_org_id,
        Some(caller_user_id),
        "integration.connected",
        crate::audit::targets::ORG,
        Some(target_org_id),
        json!({ "kind": kind, "mode": "applyTemplate", "templateId": id }),
    )
    .await;

    Ok((StatusCode::NO_CONTENT, ()).into_response())
}

// ── helpers ────────────────────────────────────────────────────────

fn caller_user_id(caller: &AdminCaller) -> Result<Uuid, AppError> {
    match caller {
        AdminCaller::User { id, .. } => Ok(*id),
        AdminCaller::LegacyAdmin | AdminCaller::DevToken => Err(AppError::Forbidden),
    }
}

fn validate_kind(kind: &str) -> Result<(), AppError> {
    if adapter_for(kind).is_none() {
        return Err(AppError::Internal(format!("unknown integration kind: {kind}")));
    }
    Ok(())
}

async fn require_owner(pool: &PgPool, id: Uuid, caller_user_id: Uuid) -> Result<(), AppError> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT owner_user_id FROM integration_templates WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(format!("load template owner: {e}")))?;
    let Some((owner_user_id,)) = row else {
        return Err(AppError::NotFound);
    };
    if owner_user_id != caller_user_id {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

async fn resolve_shared_org_id(
    pool: &PgPool,
    caller_user_id: Uuid,
    slug: Option<&str>,
) -> Result<Option<Uuid>, AppError> {
    let Some(slug) = slug else {
        return Ok(None);
    };
    if slug.is_empty() {
        return Ok(None);
    }
    // The caller must be owner/admin of the org they're sharing with
    // — otherwise sharing is a half-baked control gate.
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT o.id, m.role FROM orgs o \
         JOIN memberships m ON m.org_id = o.id \
         WHERE o.slug = $1 AND m.user_id = $2",
    )
    .bind(slug)
    .bind(caller_user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("resolve shared org: {e}")))?;
    let Some((org_id, role)) = row else {
        return Err(AppError::NotFound);
    };
    if !matches!(role.as_str(), "owner" | "admin") {
        return Err(AppError::Forbidden);
    }
    Ok(Some(org_id))
}

/// Strip secret-shaped values from a shared template's config so the
/// dashboard list view doesn't leak OAuth tokens to teammates. The
/// apply path always re-reads the owner's row, so this redaction is
/// purely cosmetic.
fn redact_config(cfg: &Value) -> Value {
    let Value::Object(map) = cfg else {
        return cfg.clone();
    };
    let mut out = serde_json::Map::with_capacity(map.len());
    for (k, v) in map {
        let lk = k.to_ascii_lowercase();
        let is_secret = lk.contains("token")
            || lk.contains("secret")
            || lk.contains("password")
            || lk.contains("key")
            || lk.ends_with("_id") && lk.starts_with("client_");
        if is_secret {
            out.insert(k.clone(), Value::String("***redacted***".into()));
        } else {
            out.insert(k.clone(), v.clone());
        }
    }
    Value::Object(out)
}
