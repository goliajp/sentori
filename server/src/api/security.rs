// v1.1 chunk S2 — security event ingest + Pin anomaly read API.
//
// Ingest:
//   POST /v1/security:report   ingest token, single event per call.
//
// Admin (dashboard):
//   GET /admin/api/projects/{id}/security/pin-anomalies?since=<rfc3339>
//     → recent pin mismatches grouped by (asn, country, server_name)
//
// SDK helper `sentori.reportPinMismatch({expected, observed, serverName})`
// flattens to `kind = 'pin.mismatch'` + `data = {expected, observed}`
// on the wire. Server doesn't validate per-kind shape; the helper is
// responsible for the schema the dashboard renders.

use std::collections::BTreeMap;

use axum::{
    extract::{ConnectInfo, Extension, Json, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;
use validator::Validate;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::event::Geo;
use crate::error::{AppError, err_response_with};
use crate::recent::AppState;

const KIND_MAX: usize = 100;
const SERVER_NAME_MAX: usize = 200;
const USER_ID_MAX: usize = 200;
const INSTALL_ID_MAX: usize = 64;
const RELEASE_MAX: usize = 200;
const ENV_MAX: usize = 64;
const DATA_KEYS_MAX: usize = 40;

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct SecurityReport {
    /// Reverse-DNS style kind. Examples: `pin.mismatch`,
    /// `root.detected`, `frida.detected`. Free-form string; the
    /// trust scoring engine in S3 weights per-kind.
    #[validate(length(min = 1, max = 100))]
    pub kind: String,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub ts: Option<OffsetDateTime>,
    #[serde(default)]
    pub data: BTreeMap<String, serde_json::Value>,
    /// Optional server name the SDK was talking to (for
    /// `pin.mismatch`, the hostname whose pin didn't match).
    pub server_name: Option<String>,
    pub user_id: Option<String>,
    /// S1 install id. Travels here as a top-level column so the
    /// trust scoring engine (S3) can group by install without
    /// cracking the `data` JSONB.
    pub install_id: Option<String>,
    pub release: Option<String>,
    pub environment: Option<String>,
}

pub async fn report(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<SecurityReport>,
) -> Response {
    if let Err(reject) = validate_report(&body) {
        return reject;
    }

    let project_id = caller_project_id(&caller, &state);
    let Some(pool) = state.db.clone() else {
        return (
            StatusCode::ACCEPTED,
            Json(json!({ "accepted": false, "reason": "dbNotConfigured" })),
        )
            .into_response();
    };

    // v1.1 audit-closeout A: enrich with GeoIP (ASN + country) the
    // same way `/v1/events` does. Trust boundary: location and ASN
    // are things the client can't prove, so the server is the source
    // of truth. The `security_events` table already has `asn` /
    // `asn_org` / `country` columns from migration 0047 — they were
    // landing as NULL because this handler skipped enrichment.
    let geo = enrich_geo(&state, &headers, peer);

    let id = Uuid::now_v7();
    if let Err(e) = insert_security_event(&pool, project_id, id, &body, geo.as_ref()).await {
        tracing::error!(error = %e, %project_id, "security event insert failed");
        return err_response_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal.unexpected",
            "could not persist security report",
            None,
            None,
            "internal",
            vec![],
        );
    }

    tracing::info!(%project_id, kind = %body.kind, "security report accepted");
    (StatusCode::ACCEPTED, Json(json!({ "id": id }))).into_response()
}

fn enrich_geo(state: &AppState, headers: &HeaderMap, peer: std::net::SocketAddr) -> Option<Geo> {
    let reader = state.geoip.as_ref()?;
    let ip = crate::geoip::client_ip_from_headers_or_peer(headers, Some(peer.ip()))?;
    reader.lookup(ip)
}

/// Validate every field on a security report. Returns `Err(Response)`
/// pre-built so the handler can `?` it out without building two
/// branches per check.
fn validate_report(body: &SecurityReport) -> Result<(), Response> {
    if let Err(e) = body.validate() {
        return Err(err_response_with(
            StatusCode::BAD_REQUEST,
            "security.invalidReport",
            "security report failed validation",
            Some("see error.details for per-field messages".to_string()),
            Some("https://sentori.golia.jp/docs/errors/security.invalidReport".to_string()),
            "domain.security",
            crate::error::flatten_validation_errors(&e),
        ));
    }
    if body.data.len() > DATA_KEYS_MAX {
        return Err(err_response_with(
            StatusCode::BAD_REQUEST,
            "security.dataTooLarge",
            format!("data has {} keys, cap is {DATA_KEYS_MAX}", body.data.len()),
            Some("flatten or pre-aggregate keys client-side".to_string()),
            None,
            "domain.security",
            vec![],
        ));
    }
    let _ = KIND_MAX;
    // (min, max, value, field-name) — the validator wants non-empty
    // when present, capped to the column width.
    let checks: &[(usize, usize, Option<&str>, &str)] = &[
        (1, SERVER_NAME_MAX, body.server_name.as_deref(), "serverName"),
        (1, USER_ID_MAX, body.user_id.as_deref(), "userId"),
        (1, INSTALL_ID_MAX, body.install_id.as_deref(), "installId"),
        (1, RELEASE_MAX, body.release.as_deref(), "release"),
        (1, ENV_MAX, body.environment.as_deref(), "environment"),
    ];
    for (min, max, value, field) in checks {
        if let Some(v) = value {
            if !(*min..=*max).contains(&v.len()) {
                return Err(bad_field(field, *max));
            }
        }
    }
    Ok(())
}

async fn insert_security_event(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    id: Uuid,
    body: &SecurityReport,
    geo: Option<&Geo>,
) -> Result<(), sqlx::Error> {
    let ts = body.ts.unwrap_or_else(OffsetDateTime::now_utc);
    let data_json = serde_json::to_value(&body.data)
        .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));
    let asn = geo.and_then(|g| g.asn).map(|n| n as i32);
    let asn_org = geo.and_then(|g| g.asn_org.as_deref());
    let country = geo.map(|g| g.country.as_str());
    sqlx::query(
        "INSERT INTO security_events
            (id, project_id, kind, user_id, install_id, release,
             environment, server_name, data, occurred_at,
             asn, asn_org, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    )
    .bind(id)
    .bind(project_id)
    .bind(&body.kind)
    .bind(body.user_id.as_deref())
    .bind(body.install_id.as_deref())
    .bind(body.release.as_deref())
    .bind(body.environment.as_deref())
    .bind(body.server_name.as_deref())
    .bind(&data_json)
    .bind(ts)
    .bind(asn)
    .bind(asn_org)
    .bind(country)
    .execute(pool)
    .await
    .map(|_| ())
}

fn bad_field(field: &str, max: usize) -> Response {
    err_response_with(
        StatusCode::BAD_REQUEST,
        "security.invalidReport",
        format!("`{field}` exceeds cap of {max} chars or is empty"),
        None,
        None,
        "domain.security",
        vec![],
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinAnomalyParams {
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub since: Option<OffsetDateTime>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinAnomalyRow {
    /// Last occurrence in the window.
    #[serde(with = "time::serde::rfc3339")]
    pub last_seen: OffsetDateTime,
    pub server_name: Option<String>,
    pub count: i64,
    /// Distinct installs that hit this anomaly.
    pub install_count: i64,
}

pub async fn list_pin_anomalies(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<PinAnomalyParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<PinAnomalyRow>::new()).into_response());
    };
    let now = OffsetDateTime::now_utc();
    let since = params.since.unwrap_or(now - time::Duration::hours(24));
    let limit = params.limit.unwrap_or(100).clamp(1, 1000);

    let rows: Vec<(Option<String>, OffsetDateTime, i64, i64)> = sqlx::query_as(
        "SELECT server_name, MAX(occurred_at), COUNT(*)::bigint, \
                COUNT(DISTINCT install_id)::bigint \
         FROM security_events \
         WHERE project_id = $1 AND kind = 'pin.mismatch' AND occurred_at >= $2 \
         GROUP BY server_name \
         ORDER BY COUNT(*) DESC \
         LIMIT $3",
    )
    .bind(project_id)
    .bind(since)
    .bind(limit)
    .fetch_all(pool as &PgPool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let out: Vec<PinAnomalyRow> = rows
        .into_iter()
        .map(|(server_name, last_seen, count, install_count)| PinAnomalyRow {
            server_name,
            last_seen,
            count,
            install_count,
        })
        .collect();
    Ok(Json(out).into_response())
}
