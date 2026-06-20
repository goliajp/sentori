use sqlx::PgPool;
use uuid::Uuid;

use crate::event::Event;

/// Outcome of an upsert — events.rs uses this to decide what
/// notification to enqueue (NewIssue / Regression / nothing).
#[derive(Debug, Clone, Copy)]
pub struct UpsertOutcome {
    pub issue_id: Uuid,
    pub is_new: bool,
    /// Phase 23 sub-D: row existed in `resolved` status when this event
    /// arrived; the upsert SQL flipped it to `regressed` atomically.
    pub regressed: bool,
}

/// Upsert an issue keyed on `(project_id, fingerprint)`.
///
/// On insert: error_type / message_sample seeded from the first event;
/// first_seen = last_seen = event timestamp; event_count = 1.
///
/// On conflict: bumps `last_seen` (max) and `event_count`, refreshes
/// `last_environment` / `last_release`. **Phase 23 sub-D**: if the row
/// was in `status = 'resolved'`, the same UPDATE flips it to
/// `regressed`, stamps `regressed_at` with the event timestamp, and
/// records `regressed_in_release` from the event payload. Atomic — no
/// read-then-write window where the dashboard could see a stale
/// `resolved` after the regression event landed.
pub async fn upsert_issue(
    pool: &PgPool,
    project_id: Uuid,
    fingerprint: &str,
    event: &Event,
) -> Result<UpsertOutcome, sqlx::Error> {
    let new_id = Uuid::now_v7();

    // v2.0 — for kind=message events `event.error` is None; the
    // issues row's `error_type` / `message_sample` come from the
    // message body instead. `"Message"` is the synthesised type so
    // the existing index on `error_type` keeps segmenting cleanly.
    let (issue_error_type, issue_message_sample): (&str, String) =
        if let Some(err) = &event.error {
            (err.r#type.as_str(), err.message.clone())
        } else {
            ("Message", event.message.clone().unwrap_or_default())
        };

    // `xmax = 0` ⇒ row was inserted, not the conflict path. The
    // regressed flag distinguishes "this UPDATE flipped status" from
    // "row was already regressed before this event" by checking that
    // `regressed_at` matches the event's own timestamp.
    let row: (Uuid, bool, bool) = sqlx::query_as(
        r#"
        INSERT INTO issues
            (id, project_id, fingerprint, error_type, message_sample,
             status, first_seen, last_seen, event_count,
             last_environment, last_release)
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, 1, $7, $8)
        ON CONFLICT (project_id, fingerprint) DO UPDATE SET
            last_seen        = GREATEST(issues.last_seen, EXCLUDED.last_seen),
            event_count      = issues.event_count + 1,
            last_environment = EXCLUDED.last_environment,
            last_release     = EXCLUDED.last_release,
            status           = CASE WHEN issues.status = 'resolved'
                                    THEN 'regressed'
                                    ELSE issues.status
                               END,
            regressed_at     = CASE WHEN issues.status = 'resolved'
                                    THEN EXCLUDED.last_seen
                                    ELSE issues.regressed_at
                               END,
            regressed_in_release = CASE WHEN issues.status = 'resolved'
                                        THEN EXCLUDED.last_release
                                        ELSE issues.regressed_in_release
                                   END
        RETURNING
            id,
            (xmax = 0) AS is_new,
            (xmax <> 0 AND status = 'regressed' AND regressed_at = $6)
                AS regressed
        "#,
    )
    .bind(new_id)
    .bind(project_id)
    .bind(fingerprint)
    .bind(issue_error_type)
    .bind(issue_message_sample)
    .bind(event.timestamp)
    .bind(&event.environment)
    .bind(&event.release)
    .fetch_one(pool)
    .await?;

    Ok(UpsertOutcome {
        issue_id: row.0,
        is_new: row.1,
        regressed: row.2,
    })
}
