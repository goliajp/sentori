// Per-issue event list + attachment enrichment.
//
// v1.1 P2 split-out of `api/admin.rs`.

use axum::{
    extract::{Json, Path, Query, State},
};
use uuid::Uuid;

use super::{EventRow, ListEventsQuery};
use crate::error::AppError;
use crate::recent::AppState;

pub async fn list_events_for_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Query(q): Query<ListEventsQuery>,
) -> Result<Json<Vec<EventRow>>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    // v2.0 — bump cap 200 → 500 so the dashboard can render the full
    // event list for high-volume issues (the previous 200 cap was
    // unreachable when an issue had > 200 events — the UI showed
    // "events 200 / N total" with no way to scroll past, making
    // dense issues unusable for triage). Cursor pagination is the
    // proper fix; v2.1 candidate.
    let limit = q.limit.unwrap_or(50).clamp(1, 500);
    let symbolicated = q.symbolicated.unwrap_or(true);
    let days = q.days.unwrap_or(90).clamp(1, 365);

    // v2.1 — `?before=<rfc3339>` advances the page beyond the
    // initial 500-row cap. Passing NULL keeps the first-page
    // behaviour (most recent N events within the lookback window).
    let mut rows: Vec<EventRow> = sqlx::query_as(
        r#"
        SELECT id, occurred_at, received_at, platform, release, environment,
               error_type, error_message, payload, trace_id, span_id
        FROM events
        WHERE project_id = $1
          AND issue_id = $2
          AND received_at >= now() - make_interval(days => $3::int)
          AND ($5::timestamptz IS NULL OR received_at < $5::timestamptz)
        ORDER BY received_at DESC
        LIMIT $4
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .bind(days as i32)
    .bind(limit)
    .bind(q.before)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    if symbolicated {
        for row in rows.iter_mut() {
            // Three passes, each a no-op on frames it doesn't own:
            //   1. JS sourcemap   — RN bridge frames at the top
            //   2. iOS DWARF      — native frames with debugId/instr
            //   3. Android proguard — JVM frames with class.method shape
            let _ = crate::symbolicate::symbolicate_payload(pool, &row.release, &mut row.payload)
                .await;
            crate::symbolicate_ios::symbolicate_payload(pool, project_id, &mut row.payload).await;
            crate::symbolicate_android::symbolicate_payload(
                pool,
                project_id,
                Some(&row.release),
                &mut row.payload,
            )
            .await;
        }
    }

    enrich_attachments(pool, project_id, &mut rows).await;

    Ok(Json(rows))
}

/// Phase 48 sub-A — replace each event's `payload.attachments` array
/// with the canonical list pulled from the `event_attachments` table.
async fn enrich_attachments(pool: &sqlx::PgPool, project_id: Uuid, rows: &mut [EventRow]) {
    if rows.is_empty() {
        return;
    }
    let event_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();

    let server_attachments: Vec<(Uuid, Uuid, String, String, i32, Option<String>)> =
        match sqlx::query_as(
            r#"
            SELECT ref, event_id, kind, media_type, size_bytes, source
            FROM event_attachments
            WHERE project_id = $1 AND event_id = ANY($2)
            ORDER BY received_at ASC
            "#,
        )
        .bind(project_id)
        .bind(&event_ids)
        .fetch_all(pool)
        .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(error = %e, "enrich_attachments query failed");
                return;
            }
        };

    let mut by_event: std::collections::HashMap<Uuid, Vec<serde_json::Value>> =
        std::collections::HashMap::new();
    for (r#ref, event_id, kind, media_type, size_bytes, source) in server_attachments {
        by_event
            .entry(event_id)
            .or_default()
            .push(serde_json::json!({
                "ref": r#ref,
                "kind": kind,
                "mediaType": media_type,
                "sizeBytes": size_bytes,
                "source": source,
            }));
    }

    for row in rows.iter_mut() {
        let attachments = by_event.remove(&row.id).unwrap_or_default();
        if let Some(obj) = row.payload.as_object_mut() {
            obj.insert(
                "attachments".to_string(),
                serde_json::Value::Array(attachments),
            );
        }
    }
}
