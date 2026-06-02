// v0.8.4 — admin CRUD for cert-watch domains + list observations.
//
// Routes (all under /admin/api, require_project_in_org middleware
// already gates project_id access via the org session):
//
//   GET    /projects/{id}/cert-monitor/domains
//   POST   /projects/{id}/cert-monitor/domains       body { domain }
//   DELETE /projects/{id}/cert-monitor/domains/{watch_id}
//   GET    /projects/{id}/cert-monitor/observations

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDomain {
    pub id: Uuid,
    pub domain: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddDomainRequest {
    pub domain: String,
}

pub async fn list_domains(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<WatchDomain>::new()).into_response());
    };
    let rows: Vec<(Uuid, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT id, domain, created_at FROM cert_watch_domains \
         WHERE project_id = $1 ORDER BY domain",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let out: Vec<WatchDomain> = rows
        .into_iter()
        .map(|(id, domain, created_at)| WatchDomain {
            id,
            domain,
            created_at,
        })
        .collect();
    Ok(Json(out).into_response())
}

pub async fn add_domain(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Json(req): Json<AddDomainRequest>,
) -> Result<Response, AppError> {
    // Light validation — strip a leading scheme/path and lowercase.
    let domain = normalise_domain(&req.domain)
        .ok_or_else(|| AppError::Internal("invalid domain".into()))?;
    let Some(pool) = &state.db else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    let id = Uuid::now_v7();
    let result = sqlx::query(
        "INSERT INTO cert_watch_domains (id, project_id, domain) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (project_id, domain) DO NOTHING \
         RETURNING id",
    )
    .bind(id)
    .bind(project_id)
    .bind(&domain)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    // Conflict (domain already watched) is treated as success — the
    // request was idempotent.
    let row_id = result.and_then(|r| r.try_get::<Uuid, _>(0).ok()).unwrap_or(id);
    Ok(Json(serde_json::json!({ "id": row_id, "domain": domain })).into_response())
}

pub async fn delete_domain(
    State(state): State<AppState>,
    Path((project_id, watch_id)): Path<(Uuid, Uuid)>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    sqlx::query("DELETE FROM cert_watch_domains WHERE id = $1 AND project_id = $2")
        .bind(watch_id)
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: Uuid,
    pub domain: String,
    pub cert_id: i64,
    pub common_name: Option<String>,
    pub name_value: Option<String>,
    pub issuer_name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub not_before: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub not_after: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub first_seen: OffsetDateTime,
}

pub async fn list_observations(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<Observation>::new()).into_response());
    };
    let rows: Vec<(
        Uuid,
        String,
        i64,
        Option<String>,
        Option<String>,
        String,
        OffsetDateTime,
        OffsetDateTime,
        OffsetDateTime,
    )> = sqlx::query_as(
        "SELECT id, domain, cert_id, common_name, name_value, issuer_name, \
                not_before, not_after, first_seen \
         FROM cert_observations \
         WHERE project_id = $1 ORDER BY first_seen DESC LIMIT 200",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    let out: Vec<Observation> = rows
        .into_iter()
        .map(
            |(
                id,
                domain,
                cert_id,
                common_name,
                name_value,
                issuer_name,
                not_before,
                not_after,
                first_seen,
            )| {
                Observation {
                    id,
                    domain,
                    cert_id,
                    common_name,
                    name_value,
                    issuer_name,
                    not_before,
                    not_after,
                    first_seen,
                }
            },
        )
        .collect();
    Ok(Json(out).into_response())
}

/// Strip scheme + path, lowercase, validate length. crt.sh accepts
/// punycode + native UTF-8; we leave that to crt.sh's parser and
/// only enforce length + character set here.
fn normalise_domain(raw: &str) -> Option<String> {
    let mut s = raw.trim().to_lowercase();
    if let Some(rest) = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")) {
        s = rest.to_string();
    }
    if let Some(idx) = s.find('/') {
        s.truncate(idx);
    }
    if s.len() < 3 || s.len() > 253 {
        return None;
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
    {
        return None;
    }
    Some(s)
}

#[cfg(test)]
mod tests {
    use super::normalise_domain;

    #[test]
    fn normalise_strips_scheme_and_path() {
        assert_eq!(
            normalise_domain("HTTPS://Example.com/path").as_deref(),
            Some("example.com")
        );
        assert_eq!(normalise_domain("  example.com  ").as_deref(), Some("example.com"));
        assert_eq!(normalise_domain("ex").as_deref(), None);
        assert_eq!(normalise_domain("space in.com").as_deref(), None);
    }
}
