//! Metric rollups — high-volume tables with monthly RANGE
//! partitioning. Paginated SELECT pattern like events / spans.

use anyhow::Result;
use serde_json::Value;
use sqlx::{PgPool, Row};
use tracing::info;

use crate::report::Report;

const PAGE: i64 = 5000;

pub async fn migrate(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let mut total = 0u64;
    total += rollup(src, dst, dry_run, report, "metric_minute").await?;
    total += rollup(src, dst, dry_run, report, "metric_hour").await?;
    total += rollup(src, dst, dry_run, report, "metric_day").await?;
    Ok(total)
}

async fn rollup(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
    table: &str,
) -> Result<u64> {
    let src_select = format!(
        "SELECT m.id, p.org_id AS workspace_id, m.project_id, m.name, m.bucket, m.tags, \
                m.sum, m.count, m.min, m.max, m.received_at \
         FROM {table} m JOIN projects p ON p.id = m.project_id \
         ORDER BY m.received_at LIMIT $1 OFFSET $2"
    );
    let dst_insert = format!(
        "INSERT INTO {table} (id, workspace_id, project_id, name, bucket, tags, sum, count, \
            min, max, received_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
         ON CONFLICT (received_at, id) DO NOTHING"
    );
    let mut written = 0u64;
    let mut skipped = 0u64;
    let mut offset: i64 = 0;
    loop {
        let rows = sqlx::query(&src_select)
            .bind(PAGE)
            .bind(offset)
            .fetch_all(src)
            .await?;
        if rows.is_empty() {
            break;
        }
        report.note_read(table, rows.len() as u64);
        for r in &rows {
            if dry_run {
                continue;
            }
            let res = sqlx::query(&dst_insert)
                .bind(r.get::<uuid::Uuid, _>("id"))
                .bind(r.get::<uuid::Uuid, _>("workspace_id"))
                .bind(r.get::<uuid::Uuid, _>("project_id"))
                .bind(r.get::<String, _>("name"))
                .bind(r.get::<time::OffsetDateTime, _>("bucket"))
                .bind(r.try_get::<Value, _>("tags").unwrap_or(Value::Null))
                .bind(r.try_get::<f64, _>("sum").unwrap_or(0.0))
                .bind(r.try_get::<i64, _>("count").unwrap_or(0))
                .bind(r.try_get::<Option<f64>, _>("min").ok().flatten())
                .bind(r.try_get::<Option<f64>, _>("max").ok().flatten())
                .bind(r.get::<time::OffsetDateTime, _>("received_at"))
                .execute(dst)
                .await?;
            if res.rows_affected() > 0 {
                written += 1;
            } else {
                skipped += 1;
            }
        }
        info!(offset, page = rows.len(), written, skipped, table = %table, "metric rollup page");
        offset += PAGE;
        if rows.len() < PAGE as usize {
            break;
        }
    }
    report.note_written(table, written);
    report.note_skipped(table, skipped);
    Ok(written)
}
