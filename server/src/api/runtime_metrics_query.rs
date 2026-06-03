// v2.1 W3 — runtime metrics admin query endpoint.
//
// GET /admin/api/projects/{id}/runtime-metrics/query
//
// Drives the dashboard's BI panel. Server picks the rollup tier
// based on (bucket, from, to) per docs/design/v2-metrics.md:
//   • to - from ≤ 1 h  + bucket ≤ 1m  → raw (on-the-fly agg)
//   • 1 h < ≤ 30 d                    → _1m
//   • 30 d < ≤ 180 d                  → _1h
//   • > 180 d                         → _1d
//
// Returns one series per (dim) tuple — the BI chart picks colors
// per series.

use axum::{
    extract::{Json, Path, Query, State},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryParams {
    /// Required — the metric name to query, e.g. "runtime.fps.p50".
    pub name: String,
    /// One of: release / environment / device_class / none.
    /// Anything else → none.
    #[serde(default)]
    pub dim: Option<String>,
    /// One of: avg / p50 / p95 / p99 / sum / count. Default: avg.
    #[serde(default)]
    pub measure: Option<String>,
    /// Time bucket — `1m` / `5m` / `15m` / `1h` / `1d`. Default 5m.
    /// Coarser-than-tier buckets trigger an on-the-fly
    /// `date_trunc(bucket, bucket_ts)` GROUP BY.
    #[serde(default)]
    pub bucket: Option<String>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub from: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub to: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponse {
    /// Which rollup tier the query landed on. Surfaced so the
    /// dashboard can show a "resolution" badge.
    pub tier: &'static str,
    pub series: Vec<Series>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    /// Tag combo identifying this series (e.g. release=v1.0.0).
    /// Empty when `dim=none`.
    pub label: String,
    pub points: Vec<Point>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    #[serde(with = "time::serde::rfc3339")]
    pub ts: OffsetDateTime,
    pub value: f64,
}

fn pick_tier(from: OffsetDateTime, to: OffsetDateTime, bucket_secs: i64) -> &'static str {
    let span = (to - from).whole_seconds();
    if span <= 3600 && bucket_secs <= 60 {
        "raw"
    } else if span <= 30 * 86400 {
        "1m"
    } else if span <= 180 * 86400 {
        "1h"
    } else {
        "1d"
    }
}

fn parse_bucket(s: &str) -> Option<i64> {
    match s {
        "1m" => Some(60),
        "5m" => Some(5 * 60),
        "15m" => Some(15 * 60),
        "1h" => Some(3600),
        "1d" => Some(86400),
        _ => None,
    }
}

fn dim_column(dim: Option<&str>) -> Option<&'static str> {
    match dim {
        Some("release") => Some("release"),
        Some("environment") => Some("environment"),
        Some("device_class") => Some("device_class"),
        _ => None,
    }
}

fn measure_expr(measure: Option<&str>, tier: &str) -> &'static str {
    // For tier=raw we compute on the fly; for rolled tiers we
    // read the pre-computed column directly.
    if tier == "raw" {
        match measure {
            Some("count") => "COUNT(*)::double precision",
            Some("sum") => "SUM(value)",
            Some("p50") => "PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY value)",
            Some("p95") => "PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY value)",
            Some("p99") => "PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY value)",
            _ => "AVG(value)",
        }
    } else {
        match measure {
            Some("count") => "count::double precision",
            Some("sum") => "sum",
            Some("p50") => "p50",
            Some("p95") => "p95",
            Some("p99") => "p99",
            _ => "avg",
        }
    }
}

pub async fn query(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<QueryParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(QueryResponse {
            tier: "raw",
            series: Vec::new(),
        })
        .into_response());
    };

    let now = OffsetDateTime::now_utc();
    let to = params.to.unwrap_or(now);
    let from = params.from.unwrap_or_else(|| now - time::Duration::hours(24));
    let bucket = params.bucket.as_deref().unwrap_or("5m");
    let bucket_secs = parse_bucket(bucket).unwrap_or(5 * 60);
    let tier = pick_tier(from, to, bucket_secs);
    let dim_col = dim_column(params.dim.as_deref());

    // Choose source table + bucket column based on tier.
    let (table, bucket_col_for_trunc) = match tier {
        "raw" => ("runtime_metrics_raw", "ts"),
        "1m" => ("runtime_metrics_1m", "bucket_ts"),
        "1h" => ("runtime_metrics_1h", "bucket_ts"),
        _ => ("runtime_metrics_1d", "bucket_ts"),
    };

    // Use date_trunc when bucket is coarser than tier resolution.
    // For tier=raw or tier=1m we already need date_trunc with the
    // requested bucket; for _1h / _1d we just SUM/AVG the rows.
    let bucket_pg = match bucket {
        "1m" => "minute",
        "5m" | "15m" => {
            // Postgres date_trunc doesn't support 5m / 15m; use
            // date_bin (Postgres 14+) for arbitrary intervals.
            // We're on PG 18 — date_bin is available.
            "minute"
        }
        "1h" => "hour",
        "1d" => "day",
        _ => "minute",
    };

    let measure_sql = measure_expr(params.measure.as_deref(), tier);

    // Build SQL. For 5m/15m we use date_bin so we can express
    // arbitrary-minute buckets cleanly.
    let bucket_select = if bucket == "5m" || bucket == "15m" {
        format!(
            "date_bin('{} minutes', {}, TIMESTAMPTZ '1970-01-01') AS b",
            if bucket == "5m" { 5 } else { 15 },
            bucket_col_for_trunc
        )
    } else {
        format!(
            "date_trunc('{}', {}) AS b",
            bucket_pg, bucket_col_for_trunc
        )
    };

    // Build dim select + group/order.
    let (dim_select, dim_group, dim_order) = match dim_col {
        Some(c) => (
            format!(", COALESCE({c}, '') AS dim"),
            format!(", dim"),
            format!(", dim"),
        ),
        None => (String::new(), String::new(), String::new()),
    };

    let sql = format!(
        "SELECT {bucket_select}, {measure_sql} AS v{dim_select} \
         FROM {table} \
         WHERE project_id = $1 \
           AND name = $2 \
           AND {bucket_col_for_trunc} >= $3 \
           AND {bucket_col_for_trunc} <  $4 \
         GROUP BY b{dim_group} \
         ORDER BY b{dim_order} \
         LIMIT 10000"
    );

    // Two query shapes — with or without dim.
    let series = if dim_col.is_some() {
        let rows: Vec<(OffsetDateTime, f64, String)> = sqlx::query_as(&sql)
            .bind(project_id)
            .bind(&params.name)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Group by dim label.
        let mut by_label: std::collections::BTreeMap<String, Vec<Point>> = Default::default();
        for (ts, value, label) in rows {
            by_label
                .entry(label)
                .or_default()
                .push(Point { ts, value });
        }
        by_label
            .into_iter()
            .map(|(label, points)| Series { label, points })
            .collect::<Vec<_>>()
    } else {
        let rows: Vec<(OffsetDateTime, f64)> = sqlx::query_as(&sql)
            .bind(project_id)
            .bind(&params.name)
            .bind(from)
            .bind(to)
            .fetch_all(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        vec![Series {
            label: String::new(),
            points: rows
                .into_iter()
                .map(|(ts, value)| Point { ts, value })
                .collect(),
        }]
    };

    Ok(Json(QueryResponse { tier, series }).into_response())
}
