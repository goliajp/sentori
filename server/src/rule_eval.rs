// Phase 27 sub-B: alert rule evaluator.
//
// Two entry points:
//   - `try_fire_on_event(...)` — called from the ingest path when an
//     event lands. Handles `new_issue` and `regression` triggers
//     synchronously so the alert lands within the same request.
//   - `spawn_cron(pool, tx)` — every 60s scans `event_count` and
//     `crash_free_drop` rules and evaluates them against the last
//     `windowMinutes` worth of data.
//
// Throttle is enforced atomically by the same UPDATE that records
// `last_fired_at = now()` — a row is "claimed" for firing only when
// the WHERE clause sees the throttle window already elapsed. Two
// evaluators racing won't double-page.
//
// Filter matching is case-sensitive substring on `environment` and
// `release`; `errorTypeRegex` is a Postgres regex (`~`). We don't
// preflight-validate the regex shape — bad regex throws at query
// time and the row's audit chain shows who armed the bad rule.

use std::time::Duration;

use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::notifier::NotifyEvent;

pub async fn try_fire_on_event(
    pool: &PgPool,
    tx: Option<&mpsc::Sender<NotifyEvent>>,
    project_id: Uuid,
    issue_id: Uuid,
    error_type: &str,
    environment: &str,
    release: &str,
    is_regression: bool,
) {
    let Some(tx) = tx else {
        return;
    };
    let trigger_kind = if is_regression { "regression" } else { "new_issue" };

    // Pull rules that match the project (or are org-wide for the same
    // org) and have this trigger kind enabled. Filter SQL handles
    // env / release / errorType; throttle gate is in the UPDATE below.
    let rows: Vec<RuleRow> = match sqlx::query_as::<_, RuleRow>(
        r#"
        SELECT r.id, r.org_id, r.name, r.channels, r.throttle_minutes, r.filter_config
        FROM alert_rules r
        JOIN projects p ON p.org_id = r.org_id
        WHERE p.id = $1
          AND r.enabled = TRUE
          AND r.muted = FALSE
          AND (r.snoozed_until IS NULL OR r.snoozed_until < now())
          AND r.trigger_kind = $2
          AND (r.project_id IS NULL OR r.project_id = $1)
        "#,
    )
    .bind(project_id)
    .bind(trigger_kind)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "alert rule lookup failed");
            return;
        }
    };

    for r in rows {
        if !filter_matches(&r.filter_config, error_type, environment, release) {
            continue;
        }
        if !claim_fire(pool, r.id, r.throttle_minutes).await {
            continue;
        }
        let summary = if is_regression {
            format!("regression of {error_type} in {release}")
        } else {
            format!("new {error_type} in {release}")
        };
        let body = format!(
            "Trigger: {trigger_kind}\n\
             Project: {project_id}\n\
             Issue:   {issue_id}\n\
             Release: {release}\n\
             Env:     {environment}\n\
             Type:    {error_type}"
        );
        let _ = tx
            .try_send(NotifyEvent::AlertFired {
                body,
                channels: r.channels,
                org_id: r.org_id,
                rule_id: r.id,
                rule_name: r.name,
                summary,
            })
            .map_err(|e| tracing::warn!(error = %e, "alert tx full"));
    }
}

#[derive(sqlx::FromRow)]
struct RuleRow {
    id: Uuid,
    org_id: Uuid,
    name: String,
    channels: Value,
    throttle_minutes: i32,
    filter_config: Value,
}

fn filter_matches(filter: &Value, error_type: &str, environment: &str, release: &str) -> bool {
    if let Some(env) = filter.get("environment").and_then(|v| v.as_str()) {
        if env != environment {
            return false;
        }
    }
    if let Some(rel) = filter.get("release").and_then(|v| v.as_str()) {
        if rel != release {
            return false;
        }
    }
    if let Some(re) = filter.get("errorTypeRegex").and_then(|v| v.as_str()) {
        if let Ok(rx) = regex::Regex::new(re) {
            if !rx.is_match(error_type) {
                return false;
            }
        } else {
            // Bad regex → never matches; rule is effectively disabled
            // until someone fixes it.
            return false;
        }
    }
    true
}

/// Atomic throttle check. Returns true exactly when this caller
/// "claimed" the fire window; concurrent callers see one true and the
/// rest false.
async fn claim_fire(pool: &PgPool, rule_id: Uuid, throttle_minutes: i32) -> bool {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"
        UPDATE alert_rules
        SET last_fired_at = now()
        WHERE id = $1
          AND (last_fired_at IS NULL
               OR last_fired_at < now() - make_interval(mins => $2::INT))
        RETURNING id
        "#,
    )
    .bind(rule_id)
    .bind(throttle_minutes)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    row.is_some()
}

/// Phase 27 sub-B: every 60s, evaluate `event_count` and
/// `crash_free_drop` rules against fresh data.
pub fn spawn_cron(pool: PgPool, tx: Option<mpsc::Sender<NotifyEvent>>) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval_at(
            tokio::time::Instant::now() + Duration::from_secs(60),
            Duration::from_secs(60),
        );
        loop {
            ticker.tick().await;
            if let Err(e) = sweep_once(&pool, tx.as_ref()).await {
                tracing::warn!(error = %e, "alert sweep failed");
            }
        }
    });
}

#[derive(sqlx::FromRow)]
struct CronRule {
    id: Uuid,
    org_id: Uuid,
    project_id: Option<Uuid>,
    name: String,
    channels: Value,
    throttle_minutes: i32,
    trigger_config: Value,
    filter_config: Value,
}

async fn sweep_event_count(
    pool: &PgPool,
    tx: Option<&mpsc::Sender<NotifyEvent>>,
) -> Result<(), sqlx::Error> {
    let rules: Vec<CronRule> = sqlx::query_as(
        "SELECT id, org_id, project_id, name, channels, throttle_minutes, \
                trigger_config, filter_config \
         FROM alert_rules \
         WHERE enabled = TRUE \
           AND muted = FALSE \
           AND (snoozed_until IS NULL OR snoozed_until < now()) \
           AND trigger_kind = 'event_count'",
    )
    .fetch_all(pool)
    .await?;

    for rule in rules {
        let Some(tx) = tx else {
            continue;
        };
        let count_threshold = rule
            .trigger_config
            .get("count")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let window_minutes = rule
            .trigger_config
            .get("windowMinutes")
            .and_then(|v| v.as_i64())
            .unwrap_or(5)
            .max(1);
        if count_threshold <= 0 {
            continue;
        }
        let env = rule.filter_config.get("environment").and_then(|v| v.as_str());
        let rel = rule.filter_config.get("release").and_then(|v| v.as_str());
        let rx = rule
            .filter_config
            .get("errorTypeRegex")
            .and_then(|v| v.as_str());

        // Org-wide rules (project_id IS NULL) match every project in
        // the org; project-scoped rules narrow to one.
        let count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*)::BIGINT FROM events e
            JOIN projects p ON p.id = e.project_id
            WHERE ($1::UUID IS NULL OR e.project_id = $1)
              AND p.org_id = $2
              AND e.received_at >= now() - make_interval(mins => $3::INT)
              AND ($4::TEXT IS NULL OR e.environment = $4)
              AND ($5::TEXT IS NULL OR e.release = $5)
              AND ($6::TEXT IS NULL OR e.error_type ~ $6)
            "#,
        )
        .bind(rule.project_id)
        .bind(rule.org_id)
        .bind(window_minutes as i32)
        .bind(env)
        .bind(rel)
        .bind(rx)
        .fetch_one(pool)
        .await?;

        if count < count_threshold {
            continue;
        }
        if !claim_fire(pool, rule.id, rule.throttle_minutes).await {
            continue;
        }
        let summary = format!("{count} events in last {window_minutes}m (≥ {count_threshold})");
        let body = format!(
            "Trigger: event_count\n\
             Threshold: {count_threshold} events / {window_minutes}m\n\
             Observed:  {count}\n\
             Filter:    {}",
            serde_json::to_string(&rule.filter_config).unwrap_or_else(|_| "{}".into())
        );
        let _ = tx
            .try_send(NotifyEvent::AlertFired {
                body,
                channels: rule.channels,
                org_id: rule.org_id,
                rule_id: rule.id,
                rule_name: rule.name,
                summary,
            });
    }
    Ok(())
}

async fn sweep_crash_free_drop(
    pool: &PgPool,
    tx: Option<&mpsc::Sender<NotifyEvent>>,
) -> Result<(), sqlx::Error> {
    let rules: Vec<CronRule> = sqlx::query_as(
        "SELECT id, org_id, project_id, name, channels, throttle_minutes, \
                trigger_config, filter_config \
         FROM alert_rules \
         WHERE enabled = TRUE \
           AND muted = FALSE \
           AND (snoozed_until IS NULL OR snoozed_until < now()) \
           AND trigger_kind = 'crash_free_drop'",
    )
    .fetch_all(pool)
    .await?;

    for rule in rules {
        let Some(tx) = tx else {
            continue;
        };
        let threshold = rule
            .trigger_config
            .get("threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.99)
            .clamp(0.0, 1.0);
        let window_minutes = rule
            .trigger_config
            .get("windowMinutes")
            .and_then(|v| v.as_i64())
            .unwrap_or(60)
            .max(1);
        let env = rule.filter_config.get("environment").and_then(|v| v.as_str());
        let rel = rule.filter_config.get("release").and_then(|v| v.as_str());

        let agg: (i64, i64) = sqlx::query_as(
            r#"
            SELECT COUNT(*)::BIGINT,
                   COUNT(*) FILTER (WHERE status = 'crashed')::BIGINT
            FROM sessions s
            JOIN projects p ON p.id = s.project_id
            WHERE ($1::UUID IS NULL OR s.project_id = $1)
              AND p.org_id = $2
              AND s.received_at >= now() - make_interval(mins => $3::INT)
              AND ($4::TEXT IS NULL OR s.environment = $4)
              AND ($5::TEXT IS NULL OR s.release = $5)
            "#,
        )
        .bind(rule.project_id)
        .bind(rule.org_id)
        .bind(window_minutes as i32)
        .bind(env)
        .bind(rel)
        .fetch_one(pool)
        .await?;
        let (total, crashed) = agg;

        // Need a minimum sample size; 10 sessions is enough to dampen
        // noise on toy projects without missing real outages on real
        // ones. Hardcoded for v0.2; later we can let rule.trigger_config
        // override it.
        if total < 10 {
            continue;
        }
        let rate = ((total - crashed) as f64) / (total as f64);
        if rate >= threshold {
            continue;
        }
        if !claim_fire(pool, rule.id, rule.throttle_minutes).await {
            continue;
        }
        let summary = format!("crash-free rate {:.2}% < {:.2}%", rate * 100.0, threshold * 100.0);
        let body = format!(
            "Trigger:   crash_free_drop\n\
             Window:    last {window_minutes}m\n\
             Sessions:  {total} (crashed: {crashed})\n\
             Rate:      {:.4}\n\
             Threshold: {:.4}\n\
             Filter:    {}",
            rate,
            threshold,
            serde_json::to_string(&rule.filter_config).unwrap_or_else(|_| "{}".into())
        );
        let _ = tx
            .try_send(NotifyEvent::AlertFired {
                body,
                channels: rule.channels,
                org_id: rule.org_id,
                rule_id: rule.id,
                rule_name: rule.name,
                summary,
            });
    }
    Ok(())
}

/// Run both cron sweeps once. Public so integration tests can drive
/// it without waiting 60s; production calls it from the cron task.
pub async fn sweep_once(
    pool: &PgPool,
    tx: Option<&mpsc::Sender<NotifyEvent>>,
) -> Result<(), sqlx::Error> {
    sweep_event_count(pool, tx).await?;
    sweep_crash_free_drop(pool, tx).await?;
    Ok(())
}

// Silences `regex` import + `json!` if reduced — they're used by the
// cargo-doc paths but rustc is paranoid in some configurations.
#[allow(dead_code)]
fn _doc_keep() -> Value {
    json!({})
}
