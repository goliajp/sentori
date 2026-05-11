// Phase 26 sub-C: session health aggregates.
//
// `GET /admin/api/projects/{project_id}/health` returns:
//   - `summary`: total / crashed / errored sessions in the window plus
//     crash-free session rate and crash-free user rate.
//   - `buckets`: time series binned by `bucket` (5m / 1h / 1d).
//
// Bucketing uses Postgres' `date_bin` (14+) so we don't have to reason
// about timezone-shifted `date_trunc`. Bucket epoch is `1970-01-01` so
// every server agrees on alignment.
//
// Crash-free user rate counts distinct `user_id` values: an anonymous
// session (user_id NULL) doesn't contribute to user-rate but still
// rolls into session-rate.

use axum::{
    extract::{Json, Path, Query, State},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthQuery {
    /// RFC 3339 inclusive lower bound. Defaults to now-24h.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub from: Option<OffsetDateTime>,
    /// RFC 3339 exclusive upper bound. Defaults to now.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub to: Option<OffsetDateTime>,
    /// `5m` / `1h` / `1d`. Defaults to `5m`.
    #[serde(default)]
    pub bucket: Option<String>,
    pub release: Option<String>,
    pub environment: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub from: String,
    pub to: String,
    pub bucket: String,
    pub summary: HealthSummary,
    pub buckets: Vec<HealthBucket>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSummary {
    pub total_sessions: i64,
    pub crashed_sessions: i64,
    pub errored_sessions: i64,
    pub total_users: i64,
    pub crashed_users: i64,
    /// `(total - crashed) / total`. NaN-safe — we ship `null` when
    /// total is 0 so the dashboard renders "no data" instead of "0%".
    pub crash_free_session_rate: Option<f64>,
    pub crash_free_user_rate: Option<f64>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HealthBucket {
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub total: i64,
    pub crashed: i64,
    pub errored: i64,
}

pub async fn handle(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(q): Query<HealthQuery>,
) -> Result<Json<HealthResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let now = OffsetDateTime::now_utc();
    let to = q.to.unwrap_or(now);
    let from = q.from.unwrap_or(to - time::Duration::hours(24));
    if from >= to {
        return Err(AppError::Internal("from must be < to".into()));
    }
    let bucket_label = q.bucket.as_deref().unwrap_or("5m");
    let bucket_interval = match bucket_label {
        "5m" => "5 minutes",
        "1h" => "1 hour",
        "1d" => "1 day",
        other => return Err(AppError::Internal(format!("invalid bucket '{other}'"))),
    };

    // Single pass over the rows: per-bucket counts + window summary.
    // We do two queries instead of overlapping windows because the
    // summary must dedupe users (DISTINCT user_id) which doesn't fit
    // cleanly into the same GROUP BY as the time bucket.

    let buckets: Vec<HealthBucket> = sqlx::query_as(
        r#"
        SELECT
            date_bin($4::INTERVAL, received_at, TIMESTAMPTZ '1970-01-01 00:00:00+00') AS at,
            COUNT(*)::BIGINT AS total,
            COUNT(*) FILTER (WHERE status = 'crashed')::BIGINT AS crashed,
            COUNT(*) FILTER (WHERE status = 'errored')::BIGINT AS errored
        FROM sessions
        WHERE project_id = $1
          AND received_at >= $2
          AND received_at <  $3
          AND ($5::TEXT IS NULL OR release = $5)
          AND ($6::TEXT IS NULL OR environment = $6)
        GROUP BY 1
        ORDER BY 1
        "#,
    )
    .bind(project_id)
    .bind(from)
    .bind(to)
    .bind(bucket_interval)
    .bind(q.release.as_deref())
    .bind(q.environment.as_deref())
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(format!("buckets: {e}")))?;

    let summary_row: (i64, i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*)::BIGINT,
            COUNT(*) FILTER (WHERE status = 'crashed')::BIGINT,
            COUNT(*) FILTER (WHERE status = 'errored')::BIGINT,
            COUNT(DISTINCT user_id)::BIGINT,
            COUNT(DISTINCT user_id) FILTER (WHERE status = 'crashed')::BIGINT
        FROM sessions
        WHERE project_id = $1
          AND received_at >= $2
          AND received_at <  $3
          AND ($4::TEXT IS NULL OR release = $4)
          AND ($5::TEXT IS NULL OR environment = $5)
        "#,
    )
    .bind(project_id)
    .bind(from)
    .bind(to)
    .bind(q.release.as_deref())
    .bind(q.environment.as_deref())
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(format!("summary: {e}")))?;

    let (total, crashed, errored, total_users, crashed_users) = summary_row;
    let summary = HealthSummary {
        crash_free_session_rate: if total == 0 {
            None
        } else {
            Some(((total - crashed) as f64) / (total as f64))
        },
        crash_free_user_rate: if total_users == 0 {
            None
        } else {
            Some(((total_users - crashed_users) as f64) / (total_users as f64))
        },
        crashed_sessions: crashed,
        crashed_users,
        errored_sessions: errored,
        total_sessions: total,
        total_users,
    };

    let to_str = to.format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| AppError::Internal(format!("format to: {e}")))?;
    let from_str = from
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| AppError::Internal(format!("format from: {e}")))?;

    Ok(Json(HealthResponse {
        bucket: bucket_label.to_string(),
        buckets,
        from: from_str,
        summary,
        to: to_str,
    }))
}
