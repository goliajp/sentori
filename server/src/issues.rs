use sqlx::PgPool;
use uuid::Uuid;

use crate::event::Event;

/// Upsert an issue keyed on `(project_id, fingerprint)`. Returns the
/// canonical issue id.
///
/// On insert: error_type / message_sample seeded from the first event;
/// first_seen = last_seen = event timestamp; event_count = 1.
///
/// On conflict: only `last_seen` (max) and `event_count` (+1) are
/// updated. `error_type` and `message_sample` stay at first-event values
/// in v0.1; later sub-sections may add a "most recent sample" path.
pub async fn upsert_issue(
    pool: &PgPool,
    project_id: Uuid,
    fingerprint: &str,
    event: &Event,
) -> Result<(Uuid, bool), sqlx::Error> {
    let new_id = Uuid::now_v7();

    // PG's `xmax` is 0 when the row was inserted (i.e. not the conflict
    // path). Used to tell new vs. updated for the new-issue notifier.
    let row: (Uuid, bool) = sqlx::query_as(
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
            last_release     = EXCLUDED.last_release
        RETURNING id, (xmax = 0) AS is_new
        "#,
    )
    .bind(new_id)
    .bind(project_id)
    .bind(fingerprint)
    .bind(&event.error.r#type)
    .bind(&event.error.message)
    .bind(event.timestamp)
    .bind(&event.environment)
    .bind(&event.release)
    .fetch_one(pool)
    .await?;

    Ok(row)
}
