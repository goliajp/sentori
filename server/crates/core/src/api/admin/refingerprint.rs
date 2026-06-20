//! v2.1 — per-issue re-fingerprint admin tool.
//!
//! Why: when grouping logic changes (e.g. v2.1 added
//! `normalize(error.message)` to error fingerprint so `mode=block`
//! vs `mode=alert-only` split), historical events keep their old
//! issue assignment. The dashboard's over-grouped issues never
//! self-heal. This endpoint lets an admin re-run grouping on a
//! single issue's events and migrate misgrouped events to new /
//! existing issues with the correct current fingerprint.
//!
//! Two-step protocol for safety:
//!
//!   1. `POST /…/re-fingerprint` with `{ "apply": false }` (default)
//!      Returns a preview: per-new-fingerprint groups + counts +
//!      sample messages + target issue id (if one exists already).
//!      No DB writes.
//!
//!   2. `POST /…/re-fingerprint` with `{ "apply": true, "confirm":
//!      "yes" }`
//!      Executes the migration. Returns the same shape as dry-run
//!      plus `applied: true`. The explicit `confirm: "yes"` body
//!      field is a typo-shield — accidental retry can't mutate.
//!
//! NEVER rule: this endpoint can mutate event-issue assignment,
//! issue counters, and (potentially) create new issues. Wrapped in
//! a single DB transaction so a mid-flight failure rolls back
//! cleanly — partial state is the worst possible outcome for
//! triage trust.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::error::AppError;
use crate::event::Event;
use crate::grouping::fingerprint;
use crate::recent::AppState;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefingerprintBody {
    /// `true` = actually move events. `false` (default) = dry-run.
    #[serde(default)]
    pub apply: bool,

    /// Required when `apply: true`. Operator-typed shield against
    /// accidental triggers — value must equal "yes" verbatim.
    #[serde(default)]
    pub confirm: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefingerprintResponse {
    /// Total events under this issue at time of inspection.
    pub total_events: i64,
    /// Current issue's stored fingerprint.
    pub current_fp: String,
    /// Per new-fingerprint group: count, sample message, target
    /// existing issue id (if any). The group whose `fp` matches
    /// `current_fp` is the events that stay.
    pub groups: Vec<RefingerprintGroup>,
    /// `false` for dry-run, `true` for executed apply.
    pub applied: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefingerprintGroup {
    pub fp: String,
    pub count: i64,
    /// First event's message body (for kind=message) OR error.message
    /// (for kind=error/anr/nearCrash). Trimmed to 200 chars.
    pub sample: String,
    /// If an issue with this fingerprint already exists in the same
    /// project, its id. `None` means "would create a fresh issue".
    pub target_issue_id: Option<Uuid>,
    /// `true` for the group whose fp matches the current issue's
    /// fingerprint — its events stay where they are.
    pub stays_in_current: bool,
}

pub async fn refingerprint_issue(
    State(state): State<AppState>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<RefingerprintBody>,
) -> Result<Json<RefingerprintResponse>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    // Validate apply gate.
    if body.apply && body.confirm.as_deref() != Some("yes") {
        return Err(AppError::BadRequest(
            "re-fingerprint apply requires `confirm: \"yes\"` in body".into(),
        ));
    }

    // Get the issue's current fingerprint + total event count.
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT fingerprint, event_count FROM issues \
         WHERE id = $1 AND project_id = $2",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let (current_fp, total_events) = row.ok_or(AppError::NotFound)?;

    // Pull every event (payload) under this issue. We need the full
    // event shape to recompute fingerprint, so unfortunately payload
    // is required here. Pagination not needed — we're scoped to
    // one issue + the new grouping policy splits issues fairly tight
    // so we won't see > 10k events per issue post-W3 fixes. If we
    // ever do, this can be batched.
    let events: Vec<(Uuid, serde_json::Value)> = sqlx::query_as(
        "SELECT id, payload FROM events \
         WHERE project_id = $1 AND issue_id = $2",
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Group event ids by their new fingerprint.
    let mut grouped: HashMap<String, Vec<Uuid>> = HashMap::new();
    let mut sample_per_fp: HashMap<String, String> = HashMap::new();
    for (event_id, payload) in events {
        let parsed: Event = match serde_json::from_value(payload) {
            Ok(e) => e,
            Err(_) => continue, // skip un-deserializable rows; rare
        };
        let new_fp = fingerprint(&parsed);
        sample_per_fp
            .entry(new_fp.clone())
            .or_insert_with(|| sample_message(&parsed));
        grouped.entry(new_fp).or_default().push(event_id);
    }

    // For each non-current-fp group, look up existing target issue
    // id (if any) — needed for both dry-run preview and apply.
    let mut groups: Vec<RefingerprintGroup> = Vec::new();
    for (fp, event_ids) in &grouped {
        let stays_in_current = fp == &current_fp;
        let target_issue_id: Option<Uuid> = if stays_in_current {
            Some(issue_id)
        } else {
            sqlx::query_scalar(
                "SELECT id FROM issues \
                 WHERE project_id = $1 AND fingerprint = $2 LIMIT 1",
            )
            .bind(project_id)
            .bind(fp)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
        };

        groups.push(RefingerprintGroup {
            fp: fp.clone(),
            count: event_ids.len() as i64,
            sample: sample_per_fp.get(fp).cloned().unwrap_or_default(),
            target_issue_id,
            stays_in_current,
        });
    }

    // Sort: current-issue group first, then by descending count.
    groups.sort_by(|a, b| {
        b.stays_in_current
            .cmp(&a.stays_in_current)
            .then(b.count.cmp(&a.count))
    });

    if !body.apply {
        return Ok(Json(RefingerprintResponse {
            total_events,
            current_fp,
            groups,
            applied: false,
        }));
    }

    // Apply path. Single transaction: move events, create missing
    // target issues, update event counts on both sides. Rolls back
    // cleanly on any error so partial state never lands.
    apply_refingerprint(pool, project_id, issue_id, &current_fp, &grouped, &sample_per_fp).await?;

    // Return same shape with applied=true. Re-query target_issue_id
    // for groups that previously had None (we may have just created
    // them); keeps the response truthful.
    let mut applied_groups = Vec::with_capacity(groups.len());
    for g in groups {
        let resolved_id = if g.target_issue_id.is_some() {
            g.target_issue_id
        } else {
            sqlx::query_scalar(
                "SELECT id FROM issues \
                 WHERE project_id = $1 AND fingerprint = $2 LIMIT 1",
            )
            .bind(project_id)
            .bind(&g.fp)
            .fetch_optional(pool)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
        };
        applied_groups.push(RefingerprintGroup {
            target_issue_id: resolved_id,
            ..g
        });
    }

    Ok(Json(RefingerprintResponse {
        total_events,
        current_fp,
        groups: applied_groups,
        applied: true,
    }))
}

/// Pull a 200-char preview message out of an event for the dry-run
/// summary. Tries `message` (kind=message), then `error.message`.
fn sample_message(e: &Event) -> String {
    let raw = e
        .message
        .as_deref()
        .or_else(|| e.error.as_ref().map(|err| err.message.as_str()))
        .unwrap_or("(no message)");
    if raw.len() > 200 {
        format!("{}…", &raw[..200])
    } else {
        raw.to_string()
    }
}

/// Apply the migration. Single transaction so partial state never
/// lands.
async fn apply_refingerprint(
    pool: &PgPool,
    project_id: Uuid,
    source_issue_id: Uuid,
    current_fp: &str,
    grouped: &HashMap<String, Vec<Uuid>>,
    sample_per_fp: &HashMap<String, String>,
) -> Result<(), AppError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    for (fp, event_ids) in grouped {
        if fp == current_fp {
            continue; // these events stay
        }

        // Find or create the target issue.
        let target_id: Uuid = match sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM issues \
             WHERE project_id = $1 AND fingerprint = $2 LIMIT 1",
        )
        .bind(project_id)
        .bind(fp)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        {
            Some(id) => id,
            None => {
                // Create a fresh issue. Use the sample message as
                // both error_type ("Message") substitute and
                // message_sample so the new issue row is readable
                // in the dashboard immediately.
                let new_id = Uuid::now_v7();
                let sample = sample_per_fp.get(fp).cloned().unwrap_or_default();
                sqlx::query(
                    "INSERT INTO issues \
                     (id, project_id, fingerprint, error_type, message_sample, \
                      status, first_seen, last_seen, event_count) \
                     SELECT $1, $2, $3, $4, $5, 'active', \
                            MIN(received_at), MAX(received_at), 0 \
                     FROM events WHERE id = ANY($6)",
                )
                .bind(new_id)
                .bind(project_id)
                .bind(fp)
                .bind("Regrouped")
                .bind(&sample)
                .bind(event_ids)
                .execute(&mut *tx)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
                new_id
            }
        };

        // Move events. Set issue_id to target.
        sqlx::query("UPDATE events SET issue_id = $1 WHERE id = ANY($2)")
            .bind(target_id)
            .bind(event_ids)
            .execute(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // Recompute event_count + first_seen + last_seen for every
    // affected issue in one shot (source + every target). Cheaper
    // to recompute from scratch than to track deltas through the
    // loop.
    let touched_issue_ids: Vec<Uuid> = {
        let mut ids: Vec<Uuid> = grouped
            .iter()
            .filter(|(fp, _)| *fp != current_fp)
            .filter_map(|_| None)
            .collect();
        // Always include the source issue (its event_count drops).
        ids.push(source_issue_id);
        // Plus every fingerprint target — re-query inside the txn.
        for fp in grouped.keys() {
            if fp == current_fp {
                continue;
            }
            if let Some(id) = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM issues \
                 WHERE project_id = $1 AND fingerprint = $2 LIMIT 1",
            )
            .bind(project_id)
            .bind(fp)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?
            {
                ids.push(id);
            }
        }
        ids
    };

    for id in touched_issue_ids {
        sqlx::query(
            "UPDATE issues SET \
               event_count = COALESCE((SELECT COUNT(*) FROM events WHERE issue_id = $1), 0), \
               first_seen = COALESCE((SELECT MIN(received_at) FROM events WHERE issue_id = $1), first_seen), \
               last_seen = COALESCE((SELECT MAX(received_at) FROM events WHERE issue_id = $1), last_seen) \
             WHERE id = $1",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}
