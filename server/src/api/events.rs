use axum::{
    extract::{Extension, Json, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;
use validator::Validate;

use crate::auth::IngestCaller;
use crate::error::AppError;
use crate::event::Event;
use crate::metrics as m;
use crate::quotas::{self, QuotaDecision};
use crate::recent::AppState;

pub async fn handle(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(mut event): Json<Event>,
) -> Result<Response, AppError> {
    let started = std::time::Instant::now();
    event.validate().map_err(|e| {
        m::ingest_rejected();
        AppError::Validation(e)
    })?;

    let project_id = caller_project_id(&caller, &state);

    // Quota gate (Phase 15 sub-B). Skipped for DevToken to keep the
    // single-tenant dev flow unconstrained; skipped silently when the
    // server is started without Valkey (the rate-limit middleware
    // already follows the same fail-open posture).
    if let (IngestCaller::Token { org_id, .. }, Some(pool), Some(valkey)) =
        (&caller, &state.db, &state.valkey)
    {
        let now = time::OffsetDateTime::now_utc();
        match quotas::check_and_record(pool, valkey.clone(), *org_id, now).await {
            Ok(QuotaDecision::Allowed { current, limit }) => {
                if let Some(tx) = &state.notifier_tx {
                    if let Err(e) =
                        quotas::maybe_warn(valkey.clone(), tx, *org_id, current, limit, now)
                            .await
                    {
                        tracing::warn!(error = %e, "quota warning enqueue failed");
                    }
                }
            }
            Ok(QuotaDecision::Exceeded { current, limit, reset_at }) => {
                tracing::warn!(%org_id, current, limit, "quota exceeded — dropping event");
                m::ingest_quota_exceeded();
                m::quota_drop();
                return Ok(quota_exceeded_response(reset_at));
            }
            Err(e) => {
                tracing::error!(error = %e, "quota check failed; admitting event");
            }
        }
    }

    tracing::info!(
        event_id = %event.id,
        platform = ?event.platform,
        error_type = %event.error.r#type,
        %project_id,
        "event accepted"
    );

    println!(
        "{}",
        serde_json::to_string_pretty(&event)
            .unwrap_or_else(|_| "<failed to serialize>".into())
    );

    if state.db.is_some() {
        if let Err(e) = persist_with_grouping(&state, project_id, &mut event).await {
            tracing::error!(error = %e, "failed to persist event");
        }
    }

    state.recent.push(event);

    m::ingest_accepted();
    m::ingest_duration(started.elapsed().as_secs_f64());

    Ok(StatusCode::ACCEPTED.into_response())
}

/// DB-backed tokens carry their project_id; the dev token is single-
/// tenant and falls back to AppState.project_id (the seeded dev row).
pub(crate) fn caller_project_id(caller: &IngestCaller, state: &AppState) -> Uuid {
    match caller {
        IngestCaller::Token { project_id, .. } => *project_id,
        IngestCaller::DevToken => state.project_id,
    }
}

pub(crate) fn quota_exceeded_response(reset_at: time::OffsetDateTime) -> Response {
    let reset_iso = reset_at
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".into());
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({
            "error": "quotaExceeded",
            "resetAt": reset_iso,
        })),
    )
        .into_response()
}

/// Compute fingerprint, upsert the issue, insert the event row linked
/// to that issue, and (if the upsert was an INSERT, not a conflict)
/// enqueue a NewIssue notification. Caller must ensure `state.db` is
/// Some.
pub(crate) async fn persist_with_grouping(
    state: &AppState,
    project_id: Uuid,
    event: &mut Event,
) -> Result<(), sqlx::Error> {
    let pool = state.db.as_ref().expect("persist_with_grouping requires db");
    // Phase 40 sub-C: if a source map is uploaded for this release,
    // rewrite the stack to original source *before* grouping — so the
    // issue keys on `src/Foo.tsx:42` not `index.bundle:1:288432`, and
    // the stored payload is already symbolicated. Best-effort.
    let release_has_map = match crate::symbolicate::symbolicate_event(pool, event).await {
        Ok(has_map) => has_map,
        Err(e) => {
            tracing::warn!(error = %e, release = %event.release, "symbolicate at ingest failed; storing raw");
            false
        }
    };
    event.symbolication = Some(crate::event::SymbolicationInfo { release_has_map });
    let fp = crate::grouping::fingerprint(event);
    let outcome = crate::issues::upsert_issue(pool, project_id, &fp, event).await?;
    persist_event_row(pool, project_id, event, Some(outcome.issue_id)).await?;

    if outcome.is_new {
        if let Some(tx) = &state.notifier_tx {
            let _ = tx.try_send(crate::notifier::NotifyEvent::NewIssue {
                project_id,
                issue_id: outcome.issue_id,
                error_type: event.error.r#type.clone(),
                message: event.error.message.clone(),
            });
        }
        // Phase 27 sub-B: also evaluate `new_issue` alert rules.
        crate::rule_eval::try_fire_on_event(
            pool,
            state.notifier_tx.as_ref(),
            project_id,
            outcome.issue_id,
            &event.error.r#type,
            &event.environment,
            &event.release,
            false,
        )
        .await;
    } else if outcome.regressed {
        // Phase 23 sub-D: regression — issue had been resolved, this
        // event flipped it back to `regressed`. Notify on_regression
        // recipients so engineers find out before users do.
        if let Some(tx) = &state.notifier_tx {
            let _ = tx.try_send(crate::notifier::NotifyEvent::Regression {
                project_id,
                issue_id: outcome.issue_id,
                error_type: event.error.r#type.clone(),
                message: event.error.message.clone(),
                release: event.release.clone(),
            });
        }
        m::issue_regressed();
        // Phase 27 sub-B: also evaluate `regression` alert rules.
        crate::rule_eval::try_fire_on_event(
            pool,
            state.notifier_tx.as_ref(),
            project_id,
            outcome.issue_id,
            &event.error.r#type,
            &event.environment,
            &event.release,
            true,
        )
        .await;
    }

    Ok(())
}

async fn persist_event_row(
    pool: &PgPool,
    project_id: Uuid,
    event: &Event,
    issue_id: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    let payload = serde_json::to_value(event)
        .expect("Event serialization should never fail");

    sqlx::query(
        r#"
        INSERT INTO events
            (id, project_id, issue_id, occurred_at, platform, release, environment,
             error_type, error_message, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        "#,
    )
    .bind(event.id)
    .bind(project_id)
    .bind(issue_id)
    .bind(event.timestamp)
    .bind(event.platform.as_str())
    .bind(&event.release)
    .bind(&event.environment)
    .bind(&event.error.r#type)
    .bind(&event.error.message)
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(())
}
