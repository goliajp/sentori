// v1.4 W16 — dispatch notification emails.
//
// Hook called from `notifications::fan_out` after each persisted
// `notifications` row when the recipient's preferences include the
// 'email' channel AND the cadence is 'immediate' (digest cadences
// route through the v0.2 W17 batch worker instead).
//
// Best-effort: a failed SMTP send writes a `status='failed'` row in
// notifications_email_log and continues. The fan_out itself never
// blocks on email — the in-app notification has already been
// persisted before this runs.

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

/// Inspect the recipient's preferences and, if `email` is in their
/// channels with cadence='immediate', dispatch a one-shot email +
/// log the attempt.
pub async fn maybe_send(
    pool: &PgPool,
    notification_id: i64,
    user_id: Uuid,
    issue_id: Uuid,
    verb: &str,
    payload: &Value,
) {
    // Pick up cadence + channels from prefs (defaults: immediate + in_app only).
    let prefs: Option<(String, Vec<String>)> = sqlx::query_as(
        "SELECT cadence, channels FROM notification_preferences WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let (cadence, channels) = match prefs {
        Some((c, ch)) => (c, ch),
        None => ("immediate".to_string(), vec!["in_app".to_string()]),
    };
    if !channels.iter().any(|c| c == "email") {
        return;
    }
    if cadence != "immediate" {
        // Digest cadences are handled by the W17 worker. Record an
        // explicit 'skipped' so the audit trail says "we saw this,
        // we batched it" rather than "we dropped it".
        let _ = sqlx::query(
            "INSERT INTO notifications_email_log \
                (notification_id, user_id, recipient_email, status, subject) \
             VALUES ($1, $2, COALESCE((SELECT email FROM users WHERE id = $2), ''), \
                     'skipped', $3)",
        )
        .bind(notification_id)
        .bind(user_id)
        .bind(format!("[batched] {verb} on issue {}", short_uuid(issue_id)))
        .execute(pool)
        .await;
        return;
    }

    // Resolve recipient email.
    let recipient: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    let Some(email) = recipient else {
        return;
    };

    let subject = subject_line(verb, issue_id);
    let body = body_text(verb, issue_id, payload);

    // Write the log row up front in 'queued' state — that's our
    // dispatch lock. Then send + UPDATE the row to delivered/failed.
    let log_id: Option<i64> = sqlx::query_scalar(
        "INSERT INTO notifications_email_log \
            (notification_id, user_id, recipient_email, status, subject) \
         VALUES ($1, $2, $3, 'queued', $4) RETURNING id",
    )
    .bind(notification_id)
    .bind(user_id)
    .bind(&email)
    .bind(&subject)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let Some(log_id) = log_id else {
        return;
    };

    let cfg = match crate::mailer::config_from_env() {
        Some(c) => c,
        None => {
            let _ = sqlx::query(
                "UPDATE notifications_email_log SET status = 'failed', \
                 last_error = 'SMTP not configured (SENTORI_SMTP_HOST unset)' \
                 WHERE id = $1",
            )
            .bind(log_id)
            .execute(pool)
            .await;
            return;
        }
    };
    let send_result = crate::mailer::send_plain(&cfg, &email, &subject, &body).await;
    let now_update = match send_result {
        Ok(()) => sqlx::query(
            "UPDATE notifications_email_log SET status = 'delivered', \
             delivered_at = now() WHERE id = $1",
        )
        .bind(log_id)
        .execute(pool)
        .await,
        Err(e) => sqlx::query(
            "UPDATE notifications_email_log SET status = 'failed', \
             last_error = $2 WHERE id = $1",
        )
        .bind(log_id)
        .bind(format!("{e}"))
        .execute(pool)
        .await,
    };
    if let Err(e) = now_update {
        tracing::warn!(error = %e, log_id, "notification email log update failed");
    }
}

/// Public diagnostic: send a one-shot test email to the operator's
/// own address. Used by the dashboard's "Send a test email" button.
/// Returns Ok with the email log row id, Err with a user-facing
/// message on failure.
pub async fn send_test_email(pool: &PgPool, user_id: Uuid, email: &str) -> Result<i64, String> {
    let subject = "Sentori test email".to_string();
    let body = format!(
        "This is a test email from Sentori.\n\n\
        If you're reading this, your notification email channel is wired:\n\
          - SMTP relay is reachable from the Sentori server\n\
          - your account email ({email}) is verified\n\n\
        Any real notification you opt into via /account/notifications will\n\
        land in the same inbox until you opt out.",
    );
    let log_id: i64 = sqlx::query_scalar(
        "INSERT INTO notifications_email_log \
            (notification_id, user_id, recipient_email, status, subject) \
         VALUES (NULL, $1, $2, 'queued', $3) RETURNING id",
    )
    .bind(user_id)
    .bind(email)
    .bind(&subject)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("log insert: {e}"))?;

    let cfg = crate::mailer::config_from_env()
        .ok_or_else(|| "SMTP not configured (SENTORI_SMTP_HOST unset)".to_string())?;
    match crate::mailer::send_plain(&cfg, email, &subject, &body).await {
        Ok(()) => {
            let _ = sqlx::query(
                "UPDATE notifications_email_log SET status = 'delivered', \
                 delivered_at = now() WHERE id = $1",
            )
            .bind(log_id)
            .execute(pool)
            .await;
            Ok(log_id)
        }
        Err(e) => {
            let msg = format!("{e}");
            let _ = sqlx::query(
                "UPDATE notifications_email_log SET status = 'failed', \
                 last_error = $2 WHERE id = $1",
            )
            .bind(log_id)
            .bind(&msg)
            .execute(pool)
            .await;
            Err(msg)
        }
    }
}

fn subject_line(verb: &str, issue_id: Uuid) -> String {
    let label = match verb {
        "status_changed" => "Status changed",
        "assignee_changed" => "Assignee changed",
        "priority_changed" => "Priority changed",
        "labels_changed" => "Labels changed",
        "merged" => "Merged",
        "commented" => "New comment",
        "regressed" => "Regressed",
        other => other,
    };
    format!("[sentori] {label} on issue {}", short_uuid(issue_id))
}

fn body_text(verb: &str, issue_id: Uuid, payload: &Value) -> String {
    let mut s = String::new();
    s.push_str(&format!("Activity on Sentori issue {}\n", issue_id));
    s.push_str(&format!("  kind: {}\n", verb));
    // Friendly payload preview — first few keys.
    if let Some(obj) = payload.as_object() {
        for (k, v) in obj.iter().take(6) {
            // Avoid dumping huge blobs into mail bodies.
            let preview: String = v.to_string().chars().take(200).collect();
            s.push_str(&format!("  {}: {}\n", k, preview));
        }
    }
    s.push_str("\n");
    s.push_str("To stop receiving these, set your channels to in-app only at\n");
    s.push_str("  /account#notifications\n");
    s
}

fn short_uuid(id: Uuid) -> String {
    id.to_string().chars().take(8).collect()
}
