// v1.4 W17 — hourly + daily notification digest worker.
//
// v1.3 W14 let operators pick a cadence in {immediate, hourly, daily}
// but only `immediate` was enforced (the email worker landed in
// v1.4 W16 fired one email per event). Hourly + daily are batch
// cadences: we accumulate `notifications` rows over the period and
// dispatch ONE digest email when the period closes.
//
// W16's notification_email::maybe_send marks per-event emails as
// `status='skipped'` for non-immediate cadences. This worker picks
// those up and rolls them into a digest.
//
// Scheduling:
//   - tokio::time::interval ticks every 60s in the background.
//   - On each tick, query users with cadence ∈ {hourly, daily}
//     whose last digest is older than the cadence's window.
//   - Send one email per due user; UPSERT digest_runs.last_sent_at.
//
// Configurable daily UTC hour via SENTORI_DIGEST_DAILY_HOUR (default 9).
// Hourly digests fire at the top of every hour.

use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// Start the digest worker. Runs on every Sentori server instance —
/// each instance independently checks the schedule and the digest_runs
/// row protects against duplicate sends via UPSERT (whoever wins the
/// last_sent_at UPDATE owns the dispatch).
pub fn spawn(pool: Arc<PgPool>) {
    tokio::spawn(async move {
        let daily_utc_hour: u8 = std::env::var("SENTORI_DIGEST_DAILY_HOUR")
            .ok()
            .and_then(|s| s.parse().ok())
            .filter(|h: &u8| *h < 24)
            .unwrap_or(9);
        tracing::info!(daily_utc_hour, "notification digest worker started");
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        // Skip the immediate first fire so we don't double-tick during
        // boot.
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = run_once(&pool, daily_utc_hour).await {
                tracing::warn!(error = %e, "digest worker tick failed");
            }
        }
    });
}

/// One tick of the worker. Public so tests can call it deterministically
/// without spinning up a tokio interval.
pub async fn run_once(pool: &PgPool, daily_utc_hour: u8) -> Result<u32, sqlx::Error> {
    let now = OffsetDateTime::now_utc();
    let hourly_threshold = now - time::Duration::hours(1);
    // Daily is "users whose last_sent_at is older than the most recent
    // crossing of HH:00 UTC" — i.e. if it's now 14:00 UTC and the
    // configured hour is 09:00, anyone whose last_sent_at < today 09:00
    // is due. We compute the threshold as the most recent prior
    // occurrence of HH:00 UTC.
    let daily_threshold = most_recent_utc_hour(now, daily_utc_hour);

    let due: Vec<(Uuid, String, String)> = sqlx::query_as(
        r#"
        SELECT u.id, np.cadence, COALESCE(u.email, '')
        FROM notification_preferences np
        JOIN users u ON u.id = np.user_id
        LEFT JOIN digest_runs dr ON dr.user_id = np.user_id AND dr.cadence = np.cadence
        WHERE np.cadence IN ('hourly','daily')
          AND ARRAY['email']::TEXT[] && np.channels
          AND (
            (np.cadence = 'hourly' AND COALESCE(dr.last_sent_at, '-infinity'::TIMESTAMPTZ) < $1)
            OR
            (np.cadence = 'daily'  AND COALESCE(dr.last_sent_at, '-infinity'::TIMESTAMPTZ) < $2)
          )
        "#,
    )
    .bind(hourly_threshold)
    .bind(daily_threshold)
    .fetch_all(pool)
    .await?;

    let mut sent = 0u32;
    for (user_id, cadence, email) in due {
        // Collect the user's skipped or queued email log rows since
        // their last digest.
        let cutoff: OffsetDateTime = sqlx::query_scalar::<_, Option<OffsetDateTime>>(
            "SELECT last_sent_at FROM digest_runs WHERE user_id = $1 AND cadence = $2",
        )
        .bind(user_id)
        .bind(&cadence)
        .fetch_optional(pool)
        .await?
        .flatten()
        .unwrap_or_else(|| now - time::Duration::days(1));
        let unread_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM notifications n \
             WHERE n.user_id = $1 AND n.created_at > $2 AND n.read_at IS NULL",
        )
        .bind(user_id)
        .bind(cutoff)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        if unread_count == 0 {
            // Nothing to send; still bump last_sent_at so we don't
            // wake up for this user every tick.
            upsert_digest_run(pool, user_id, &cadence, now).await?;
            continue;
        }
        if email.is_empty() {
            upsert_digest_run(pool, user_id, &cadence, now).await?;
            continue;
        }
        // Pick a sample of recent issues for the body.
        let sample: Vec<(Uuid, String, i64)> = sqlx::query_as(
            "SELECT n.issue_id, MIN(n.kind), COUNT(*)::bigint \
             FROM notifications n \
             WHERE n.user_id = $1 AND n.created_at > $2 AND n.read_at IS NULL \
             GROUP BY n.issue_id \
             ORDER BY MAX(n.created_at) DESC \
             LIMIT 20",
        )
        .bind(user_id)
        .bind(cutoff)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        let subject = format!(
            "[sentori] {} digest — {} new on {} issue{}",
            cadence,
            unread_count,
            sample.len(),
            if sample.len() == 1 { "" } else { "s" }
        );
        let mut body = format!(
            "You have {} unread Sentori notification{} across {} issue{}.\n\n",
            unread_count,
            if unread_count == 1 { "" } else { "s" },
            sample.len(),
            if sample.len() == 1 { "" } else { "s" },
        );
        for (issue_id, kind, count) in &sample {
            body.push_str(&format!("- {} (×{}) — issue {}\n", kind, count, issue_id));
        }
        body.push_str("\nOpen the dashboard to triage:\n  /\n\n");
        body.push_str(
            "To change cadence or unsubscribe, visit /account#notifications.\n",
        );

        let cfg = match crate::mailer::config_from_env() {
            Some(c) => c,
            None => {
                tracing::warn!("digest worker: SMTP not configured; skipping");
                upsert_digest_run(pool, user_id, &cadence, now).await?;
                continue;
            }
        };
        let send_result = crate::mailer::send_plain(&cfg, &email, &subject, &body).await;
        // Log the digest itself for audit.
        let log_status = match &send_result {
            Ok(()) => "delivered",
            Err(_) => "failed",
        };
        let _ = sqlx::query(
            "INSERT INTO notifications_email_log \
                (user_id, recipient_email, status, subject, delivered_at, last_error) \
             VALUES ($1, $2, $3, $4, \
                     CASE WHEN $3 = 'delivered' THEN now() ELSE NULL END, $5)",
        )
        .bind(user_id)
        .bind(&email)
        .bind(log_status)
        .bind(&subject)
        .bind(match &send_result {
            Ok(()) => None,
            Err(e) => Some(format!("{e}")),
        })
        .execute(pool)
        .await;
        upsert_digest_run(pool, user_id, &cadence, now).await?;
        if send_result.is_ok() {
            sent += 1;
        }
    }
    Ok(sent)
}

async fn upsert_digest_run(
    pool: &PgPool,
    user_id: Uuid,
    cadence: &str,
    at: OffsetDateTime,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO digest_runs (user_id, cadence, last_sent_at) \
         VALUES ($1, $2, $3) \
         ON CONFLICT (user_id, cadence) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at",
    )
    .bind(user_id)
    .bind(cadence)
    .bind(at)
    .execute(pool)
    .await?;
    Ok(())
}

fn most_recent_utc_hour(now: OffsetDateTime, hour: u8) -> OffsetDateTime {
    let today = now.replace_time(
        time::Time::from_hms(hour, 0, 0).unwrap_or(time::Time::MIDNIGHT),
    );
    if today <= now {
        today
    } else {
        today - time::Duration::days(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::datetime;

    #[test]
    fn most_recent_utc_hour_picks_today_when_past() {
        let now = datetime!(2026-05-20 14:30:00 UTC);
        let t = most_recent_utc_hour(now, 9);
        assert_eq!(t, datetime!(2026-05-20 09:00:00 UTC));
    }

    #[test]
    fn most_recent_utc_hour_falls_back_to_yesterday_when_future() {
        let now = datetime!(2026-05-20 05:30:00 UTC);
        let t = most_recent_utc_hour(now, 9);
        assert_eq!(t, datetime!(2026-05-19 09:00:00 UTC));
    }
}
