//! events table (RANGE partitioned by received_at, monthly).
//!
//! High-volume — uses streamed cursor (limit/offset paging) so we
//! don't load the entire table into memory.

use anyhow::Result;
use serde_json::Value;
use sqlx::{PgPool, Row};
use tracing::info;

use crate::report::Report;

const PAGE: i64 = 1000;

pub async fn migrate(
    src: &PgPool,
    dst: &PgPool,
    dry_run: bool,
    report: &mut Report,
) -> Result<u64> {
    let mut written = 0u64;
    let mut skipped = 0u64;
    let mut offset: i64 = 0;
    loop {
        let rows = sqlx::query(
            "SELECT e.id, p.org_id AS workspace_id, e.project_id, e.issue_id, e.timestamp, \
                    e.kind, e.platform, e.release, e.environment, e.payload, e.received_at \
             FROM events e JOIN projects p ON p.id = e.project_id \
             ORDER BY e.received_at, e.id LIMIT $1 OFFSET $2",
        )
        .bind(PAGE)
        .bind(offset)
        .fetch_all(src)
        .await?;
        if rows.is_empty() {
            break;
        }
        report.note_read("events", rows.len() as u64);
        for r in &rows {
            if dry_run {
                continue;
            }
            let res = sqlx::query(
                "INSERT INTO events (id, workspace_id, project_id, issue_id, timestamp, \
                    kind, platform, release, environment, payload, received_at) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (received_at, id) DO NOTHING",
            )
            .bind(r.get::<uuid::Uuid, _>("id"))
            .bind(r.get::<uuid::Uuid, _>("workspace_id"))
            .bind(r.get::<uuid::Uuid, _>("project_id"))
            .bind(r.get::<uuid::Uuid, _>("issue_id"))
            .bind(r.get::<time::OffsetDateTime, _>("timestamp"))
            .bind(r.get::<String, _>("kind"))
            .bind(r.get::<String, _>("platform"))
            .bind(r.get::<String, _>("release"))
            .bind(r.get::<String, _>("environment"))
            .bind(r.get::<Value, _>("payload"))
            .bind(r.get::<time::OffsetDateTime, _>("received_at"))
            .execute(dst)
            .await?;
            if res.rows_affected() > 0 {
                written += 1;
            } else {
                skipped += 1;
            }
        }
        info!(offset, page = rows.len(), written, skipped, "events page");
        offset += PAGE;
        if rows.len() < PAGE as usize {
            break;
        }
    }
    report.note_written("events", written);
    report.note_skipped("events", skipped);
    Ok(written)
}
