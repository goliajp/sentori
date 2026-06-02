// Phase 27 sub-E: digest evaluator.
//
// Every hour, scan `digest_subscriptions` for rows whose
// `last_sent_at + frequency_window < now()`. For each due row we
// compute a small org-wide summary over the corresponding window and
// fire a NotifyEvent::DigestEmail.
//
// Sample size: digests are user-grain, not org-grain. Two users in
// the same org both subscribed to daily get the same summary text but
// each receive their own email — keeps the unsubscribe link path
// simple (delete one row, not part of a per-org broadcast list).
//
// `sweep_once` is exposed so integration tests can drive the
// evaluator without waiting an hour.

use std::time::Duration;

use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::notifier::NotifyEvent;

pub fn spawn_cron(pool: PgPool, tx: Option<mpsc::Sender<NotifyEvent>>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_secs(60 * 60),
            Duration::from_secs(60 * 60),
        );
        loop {
            ticker.tick().await;
            if let Err(e) = sweep_once(&pool, tx.as_ref()).await {
                tracing::warn!(error = %e, "digest sweep failed");
            }
        }
    });
}

#[derive(sqlx::FromRow)]
struct DueRow {
    user_id: Uuid,
    user_email: String,
    org_id: Uuid,
    org_name: String,
    org_slug: String,
    frequency: String,
}

pub async fn sweep_once(
    pool: &PgPool,
    tx: Option<&mpsc::Sender<NotifyEvent>>,
) -> Result<usize, sqlx::Error> {
    // Pull rows whose window has elapsed. `make_interval` builds the
    // 24h / 7d window from the frequency string at query time so we
    // don't need a CASE here.
    let rows: Vec<DueRow> = sqlx::query_as(
        r#"
        SELECT
            d.user_id, u.email AS user_email,
            d.org_id, o.name AS org_name, o.slug AS org_slug,
            d.frequency
        FROM digest_subscriptions d
        JOIN users u ON u.id = d.user_id
        JOIN orgs  o ON o.id = d.org_id
        WHERE d.last_sent_at IS NULL
           OR d.last_sent_at < now() - CASE d.frequency
               WHEN 'daily'  THEN INTERVAL '24 hours'
               WHEN 'weekly' THEN INTERVAL '7 days'
               ELSE INTERVAL '1000 years'
             END
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut sent = 0usize;
    let now = OffsetDateTime::now_utc();

    for row in &rows {
        let window_hours: i32 = if row.frequency == "weekly" { 24 * 7 } else { 24 };
        let summary = compose_summary(pool, row.org_id, window_hours).await?;
        if let Some(tx) = tx {
            let _ = tx.try_send(NotifyEvent::DigestEmail {
                to: row.user_email.clone(),
                org_name: row.org_name.clone(),
                org_slug: row.org_slug.clone(),
                frequency: row.frequency.clone(),
                summary_lines: summary,
                window_hours: window_hours as u32,
            });
        }
        // Mark sent regardless of notifier success — we'd rather skip
        // a duplicate digest than spam on retries.
        let _ = sqlx::query(
            "UPDATE digest_subscriptions SET last_sent_at = $1 \
             WHERE user_id = $2 AND org_id = $3 AND frequency = $4",
        )
        .bind(now)
        .bind(row.user_id)
        .bind(row.org_id)
        .bind(&row.frequency)
        .execute(pool)
        .await;
        sent += 1;
    }
    Ok(sent)
}

#[derive(Debug, Clone)]
pub struct DigestSummary {
    pub new_issues: i64,
    pub regressed_issues: i64,
    pub events_total: i64,
    pub crashed_sessions: i64,
    pub total_sessions: i64,
    pub crash_free_rate: Option<f64>,
}

/// Build a human-readable summary as a Vec<String> ready to dump into
/// an email body. Keeps email composition out of the cron path so the
/// notifier owns formatting.
async fn compose_summary(
    pool: &PgPool,
    org_id: Uuid,
    window_hours: i32,
) -> Result<Vec<String>, sqlx::Error> {
    let s = aggregate(pool, org_id, window_hours).await?;
    let crash_free = s
        .crash_free_rate
        .map(|r| format!("{:.2}%", r * 100.0))
        .unwrap_or_else(|| "—".into());
    Ok(vec![
        format!("Window:           last {window_hours}h"),
        format!("New issues:       {}", s.new_issues),
        format!("Regressed issues: {}", s.regressed_issues),
        format!("Events:           {}", s.events_total),
        format!(
            "Sessions:         {} ({} crashed)",
            s.total_sessions, s.crashed_sessions
        ),
        format!("Crash-free rate:  {crash_free}"),
    ])
}

pub async fn aggregate(
    pool: &PgPool,
    org_id: Uuid,
    window_hours: i32,
) -> Result<DigestSummary, sqlx::Error> {
    let new_issues: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::BIGINT FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1
          AND i.first_seen >= now() - make_interval(hours => $2::INT)
        "#,
    )
    .bind(org_id)
    .bind(window_hours)
    .fetch_one(pool)
    .await?;
    let regressed_issues: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::BIGINT FROM issues i
        JOIN projects p ON p.id = i.project_id
        WHERE p.org_id = $1
          AND i.regressed_at >= now() - make_interval(hours => $2::INT)
        "#,
    )
    .bind(org_id)
    .bind(window_hours)
    .fetch_one(pool)
    .await?;
    let events_total: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::BIGINT FROM events e
        JOIN projects p ON p.id = e.project_id
        WHERE p.org_id = $1
          AND e.received_at >= now() - make_interval(hours => $2::INT)
        "#,
    )
    .bind(org_id)
    .bind(window_hours)
    .fetch_one(pool)
    .await?;
    let (total_sessions, crashed_sessions): (i64, i64) = sqlx::query_as(
        r#"
        SELECT COUNT(*)::BIGINT,
               COUNT(*) FILTER (WHERE status = 'crashed')::BIGINT
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        WHERE p.org_id = $1
          AND s.received_at >= now() - make_interval(hours => $2::INT)
        "#,
    )
    .bind(org_id)
    .bind(window_hours)
    .fetch_one(pool)
    .await?;

    let crash_free_rate = if total_sessions == 0 {
        None
    } else {
        Some(((total_sessions - crashed_sessions) as f64) / (total_sessions as f64))
    };
    Ok(DigestSummary {
        crash_free_rate,
        crashed_sessions,
        events_total,
        new_issues,
        regressed_issues,
        total_sessions,
    })
}

#[allow(dead_code)]
fn _doc_keep() -> serde_json::Value {
    json!({})
}
