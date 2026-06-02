use axum::{
    extract::{ConnectInfo, Extension, Json, State},
    http::{HeaderMap, StatusCode},
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
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Json(mut event): Json<Event>,
) -> Result<Response, AppError> {
    let started = std::time::Instant::now();
    event.validate().map_err(|e| {
        m::ingest_rejected();
        AppError::Validation(e)
    })?;

    // v2.0 W1 — cross-field validation that `validator` can't express
    // declaratively. `kind = message` requires both `message` and
    // `level`; other kinds require `error`.
    validate_event_kind(&event).map_err(|e| {
        m::ingest_rejected();
        e
    })?;

    // v0.8.0-d — overwrite any client-supplied `geo` with the
    // server's own lookup. Trust boundary: location is something
    // the client *can't* prove, so the server is the source of truth.
    // Lookup is skipped (event.geo stays None) when the db isn't
    // loaded or the client is on a private range.
    event.geo = None;
    if let Some(reader) = &state.geoip {
        if let Some(ip) = crate::geoip::client_ip_from_headers_or_peer(&headers, Some(peer.ip())) {
            if let Some(g) = reader.lookup(ip) {
                event.geo = Some(g);
            }
        }
    }

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

    let error_type = event
        .error
        .as_ref()
        .map(|e| e.r#type.as_str())
        .unwrap_or("Message"); // v2.0: kind=message has no error object
    tracing::info!(
        event_id = %event.id,
        platform = ?event.platform,
        %error_type,
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

    // Phase 50 sub-A1: fan out a tick to the SSE live-feed subscribers
    // before pushing into the in-memory ring (the kind we want from
    // the event is computed below). `send` errors when there are zero
    // subscribers — that's the common case and not an error.
    let kind = match event.kind {
        crate::event::EventKind::Anr => "anr",
        crate::event::EventKind::Error => "error",
        crate::event::EventKind::NearCrash => "nearCrash",
        crate::event::EventKind::Message => "message",
    };
    let _ = state.event_ticks.send(crate::recent::EventTick {
        kind: kind.to_string(),
        project_id,
        ts_ms: time::OffsetDateTime::now_utc().unix_timestamp() * 1000,
    });

    // v0.9.3 +S7 — live-debug fanout. Only events tagged with a
    // user.id are interesting; others would just spam every live
    // subscriber. `send` errors when there are zero subscribers,
    // which is the common path: harmless. `project_id` is included
    // so the SSE filter can scope to one project — two projects with
    // the same external `user.id` (an email, an auth0 sub) would
    // otherwise cross-leak.
    if event.user.as_ref().and_then(|u| u.id.as_deref()).is_some() {
        let _ = state.live_events.send(crate::recent::LiveEvent {
            project_id,
            event: event.clone(),
        });
    }

    state.recent.push(event);

    m::ingest_accepted();
    m::ingest_duration(started.elapsed().as_secs_f64());

    Ok(StatusCode::ACCEPTED.into_response())
}

/// v2.0 W1 — kind-dispatched cross-field validation.
///
/// - `kind = error / anr / nearCrash` → must carry `error: ...`
/// - `kind = message` → must carry `message: ...` (non-empty) and
///   `level: ...`. The `validator` crate handles the per-field
///   shape; here we enforce the kind-dispatched presence rule.
fn validate_event_kind(event: &Event) -> Result<(), AppError> {
    use crate::event::EventKind;
    match event.kind {
        EventKind::Message => {
            if event.message.as_deref().map(str::is_empty).unwrap_or(true) {
                return Err(AppError::BadRequest(
                    "event with kind=message requires non-empty message".into(),
                ));
            }
            if event.level.is_none() {
                return Err(AppError::BadRequest(
                    "event with kind=message requires level".into(),
                ));
            }
        }
        EventKind::Error | EventKind::Anr | EventKind::NearCrash => {
            if event.error.is_none() {
                return Err(AppError::BadRequest(format!(
                    "event with kind={:?} requires error object",
                    event.kind
                )));
            }
        }
    }

    // v2.3 — every linkHashes value must be a 64-char lowercase hex
    // sha256. Anything else (e.g. a raw "lihao@golia.jp" leaked
    // through a buggy SDK) is rejected before the row hits the
    // events table. Defence-in-depth against PII slipping through.
    if let Some(user) = event.user.as_ref() {
        if let Some(link_hashes) = user.link_hashes.as_ref() {
            for (key_type, value) in link_hashes {
                if !crate::identity::is_valid_client_hash(value) {
                    return Err(AppError::BadRequest(format!(
                        "linkHashes[{key_type}] is not a 64-char lowercase hex sha256 \
                         — raw identity values must be hashed client-side",
                    )));
                }
            }
        }
    }

    Ok(())
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
    // Phase 42 sub-C.05: every claimed attachment ref must match a
    // row we issued for this (event_id, project_id). A mismatch means
    // either a forged ref or a cross-event swap — drop the bad refs
    // (not the whole event) so the dashboard still gets the error
    // text + stack. Single-path: lives here so both /v1/events and
    // /v1/events:batch run the check.
    if !event.attachments.is_empty() {
        event.attachments = filter_valid_attachments(pool, project_id, event).await;
    }
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

    // v2.3 — write identity fingerprints if the host called
    // `setUser({ linkBy: { ... } })`. Validation already happened
    // up front (validate_event below); here we just hash each entry
    // with the scope salt + persist. No-op for the common case
    // where the event has no link_hashes (host hasn't called setUser
    // with identities).
    if let Some(user) = event.user.as_ref() {
        if let Some(link_hashes) = user.link_hashes.as_ref() {
            if !link_hashes.is_empty() {
                if let Err(e) = crate::identity::write_event_fingerprints(
                    pool,
                    event.id,
                    project_id,
                    link_hashes,
                )
                .await
                {
                    tracing::warn!(
                        error = %e,
                        event_id = %event.id,
                        "identity fingerprint write failed (event still persisted)",
                    );
                }
            }
        }
    }

    // v2.0 — extract "type" + "message" strings that downstream
    // notifications / integrations / alert rules expect, regardless
    // of event kind. For error/anr/nearCrash they come from
    // `event.error`; for kind=message they synthesize to
    // ("Message", event.message).
    let (notify_type, notify_message): (String, String) = if let Some(err) = &event.error {
        (err.r#type.clone(), err.message.clone())
    } else {
        (
            "Message".to_string(),
            event.message.clone().unwrap_or_default(),
        )
    };

    if outcome.is_new {
        if let Some(tx) = &state.notifier_tx {
            let _ = tx.try_send(crate::notifier::NotifyEvent::NewIssue {
                project_id,
                issue_id: outcome.issue_id,
                error_type: notify_type.clone(),
                message: notify_message.clone(),
            });
        }
        // Phase 43 sub-B.01: also kick off integration dispatch (Linear /
        // Slack / …) off the ingest hot path. tokio::spawn so any
        // upstream API latency never reaches event persist.
        {
            let pool = pool.clone();
            let project_id = project_id;
            let issue_id = outcome.issue_id;
            let error_type = notify_type.clone();
            let error_message = notify_message.clone();
            let release = event.release.clone();
            let environment = event.environment.clone();
            let base_url = state.base_url.clone();
            tokio::spawn(async move {
                crate::integrations::dispatch::on_new_issue(
                    crate::integrations::dispatch::DispatchInput {
                        pool: &pool,
                        project_id,
                        issue_id,
                        error_type: &error_type,
                        error_message: &error_message,
                        release: &release,
                        environment: &environment,
                        base_url: &base_url,
                    },
                )
                .await;
            });
        }
        // Phase 27 sub-B: also evaluate `new_issue` alert rules.
        crate::rule_eval::try_fire_on_event(
            pool,
            state.notifier_tx.as_ref(),
            project_id,
            outcome.issue_id,
            &notify_type,
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
                error_type: notify_type.clone(),
                message: notify_message.clone(),
                release: event.release.clone(),
            });
        }
        m::issue_regressed();
        // v1.2 W5: audit-log the ingest-driven regression so the
        // dashboard timeline shows "regressed from a new event in
        // release X" without having to reconstruct it from
        // regressed_at + last_release. Fire-and-forget — ingest hot
        // path stays unblocked.
        {
            let pool = pool.clone();
            let issue_id = outcome.issue_id;
            let release = event.release.clone();
            tokio::spawn(async move {
                crate::activity_log::write(
                    &pool,
                    issue_id,
                    None,
                    crate::activity_log::verb::REGRESSED,
                    serde_json::json!({ "release": release }),
                )
                .await;
            });
        }
        // Phase 43 sub-B.01: same dispatch as new-issue but with
        // `Regressed` lifecycle — adapters post a re-open comment.
        {
            let pool = pool.clone();
            let issue_id = outcome.issue_id;
            tokio::spawn(async move {
                crate::integrations::dispatch::on_status_change(
                    &pool,
                    issue_id,
                    crate::integrations::IssueLifecycleEvent::Regressed,
                )
                .await;
            });
        }
        // Phase 27 sub-B: also evaluate `regression` alert rules.
        crate::rule_eval::try_fire_on_event(
            pool,
            state.notifier_tx.as_ref(),
            project_id,
            outcome.issue_id,
            &notify_type,
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

    // v2.0: `error` is optional (None for `kind = message`). For the
    // legacy `error_type` / `error_message` columns we fall back to
    // the message-event fields where applicable so dashboard search
    // / filter on message bodies still works without a join.
    let (error_type, error_message): (Option<&str>, Option<&str>) =
        if let Some(err) = &event.error {
            (Some(err.r#type.as_str()), Some(err.message.as_str()))
        } else {
            // For kind = message: synthesize "Message" type so the
            // existing column-typed indexes still segment cleanly.
            let body = event.message.as_deref();
            (Some("Message"), body)
        };

    let level: Option<&str> = event.level.as_ref().map(|l| match l {
        crate::event::MessageLevel::Fatal => "fatal",
        crate::event::MessageLevel::Error => "error",
        crate::event::MessageLevel::Warning => "warning",
        crate::event::MessageLevel::Info => "info",
        crate::event::MessageLevel::Debug => "debug",
    });

    sqlx::query(
        r#"
        INSERT INTO events
            (id, project_id, issue_id, occurred_at, platform, release, environment,
             error_type, error_message, level, message, payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#,
    )
    .bind(event.id)
    .bind(project_id)
    .bind(issue_id)
    .bind(event.timestamp)
    .bind(event.platform.as_str())
    .bind(&event.release)
    .bind(&event.environment)
    .bind(error_type)
    .bind(error_message)
    .bind(level)
    .bind(event.message.as_deref())
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(())
}


/// Phase 42 sub-C.05 — drop any `event.attachments[].ref` we don't
/// have a matching `event_attachments` row for. The row must match
/// both the event_id and project_id we'd associate this event with.
/// Returns the surviving refs in input order.
async fn filter_valid_attachments(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    event: &Event,
) -> Vec<crate::event::AttachmentRef> {
    if event.attachments.is_empty() {
        return Vec::new();
    }
    let refs: Vec<Uuid> = event.attachments.iter().map(|a| a.r#ref).collect();
    let found: Vec<Uuid> = sqlx::query_scalar(
        "SELECT ref FROM event_attachments \
         WHERE ref = ANY($1) AND event_id = $2 AND project_id = $3",
    )
    .bind(&refs)
    .bind(event.id)
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let valid: std::collections::HashSet<Uuid> = found.into_iter().collect();
    let mut out = Vec::with_capacity(event.attachments.len());
    let mut dropped = 0u32;
    for a in &event.attachments {
        if valid.contains(&a.r#ref) {
            out.push(a.clone());
        } else {
            dropped += 1;
        }
    }
    if dropped > 0 {
        tracing::warn!(
            event_id = %event.id,
            %project_id,
            dropped,
            "dropped attachment refs not matching any row"
        );
    }
    out
}
