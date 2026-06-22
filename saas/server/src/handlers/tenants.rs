//! /v1/saas/tenants — list + create.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::state::AppState;
use crate::tenant_provision::{create_tenant_db, is_safe_db_name, record_step};

#[derive(Serialize)]
pub struct TenantRow {
    pub id: Uuid,
    pub slug: String,
    pub display_name: String,
    pub status: String,
    pub created_at: OffsetDateTime,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<TenantRow>>, (StatusCode, String)> {
    let rows: Vec<(Uuid, String, String, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT id, slug, display_name, status, created_at FROM tenants \
         WHERE status != 'deleted' ORDER BY created_at DESC LIMIT 200",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, slug, display_name, status, created_at)| TenantRow {
                id,
                slug,
                display_name,
                status,
                created_at,
            })
            .collect(),
    ))
}

#[derive(Deserialize)]
pub struct CreateBody {
    pub slug: String,
    pub display_name: String,
    pub owner_email: String,
}

#[derive(Serialize)]
pub struct CreateResponse {
    pub id: Uuid,
    pub slug: String,
    pub db_name: String,
    pub status: String,
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<CreateResponse>), (StatusCode, String)> {
    let slug = body.slug.trim().to_ascii_lowercase();
    if slug.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "slug required".into()));
    }
    let db_name = format!("sentori_t_{}", slug.replace('-', "_"));
    if !is_safe_db_name(&db_name) {
        return Err((StatusCode::BAD_REQUEST, "slug fails safety check".into()));
    }

    let id = Uuid::now_v7();
    // Register the tenant row first (status='provisioning')
    // so a crashed mid-provision is observable.
    sqlx::query(
        "INSERT INTO tenants (id, slug, display_name, db_name, owner_email) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(id)
    .bind(&slug)
    .bind(body.display_name.trim())
    .bind(&db_name)
    .bind(body.owner_email.trim())
    .execute(&state.pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db_err) if db_err.code().as_deref() == Some("23505") => {
            (StatusCode::CONFLICT, format!("slug {slug:?} already exists"))
        }
        _ => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    })?;

    // create_db step.
    let _ = record_step(&state.pool, id, "create_db", "running", None).await;
    if let Err(e) = create_tenant_db(&state.tenant_db_admin_url, &db_name).await {
        let _ = record_step(&state.pool, id, "create_db", "failed", Some(&e.to_string())).await;
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("create tenant DB: {e}"),
        ));
    }
    let _ = record_step(&state.pool, id, "create_db", "done", None).await;

    // migrate + seed_owner steps run async — for v0.1, they
    // happen out-of-band via the `sentori-saas-provisioner`
    // CLI (defer to ops follow-up). The tenant row stays in
    // 'provisioning' until activated.
    let _ = record_step(
        &state.pool,
        id,
        "migrate",
        "pending",
        Some("pending — run sentori-saas-provisioner activate"),
    )
    .await;

    Ok((
        StatusCode::ACCEPTED,
        Json(CreateResponse {
            id,
            slug,
            db_name,
            status: "provisioning".into(),
        }),
    ))
}
