// Phase 43 sub-B.01 — issue lifecycle → integrations dispatch.
//
// Called off the ingest hot path (`tokio::spawn` from events.rs +
// issues.rs) so Linear / Slack latency never blocks event persist.
// Each entry point is best-effort: failures log + return without
// poisoning the caller. Idempotency is enforced via
// `issue_integration_links` PK on `(issue_id, integration_kind)`.

use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use super::linear::LinearAdapter;
use super::{IntegrationAdapter, IntegrationError, IssueContext, IssueLifecycleEvent};

/// Build the (issue, project, event) context once, share between
/// adapters. `base_url` is the dashboard origin so adapters can
/// embed an issue link.
pub struct DispatchInput<'a> {
    pub pool: &'a PgPool,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub error_type: &'a str,
    pub error_message: &'a str,
    pub release: &'a str,
    pub environment: &'a str,
    pub base_url: &'a str,
}

/// New-issue path: fire `create_issue` against every adapter
/// configured for the project's org, store the resulting external
/// ref in `issue_integration_links`. Skips silently when the org
/// has no active integration / when a link already exists.
pub async fn on_new_issue(input: DispatchInput<'_>) {
    let org_id = match resolve_org_id(input.pool, input.project_id).await {
        Some(id) => id,
        None => return,
    };
    let org_slug = match resolve_org_slug(input.pool, org_id).await {
        Some(s) => s,
        None => return,
    };

    let ctx = build_context(&input, &org_slug, /*event_count=*/ 1);

    for (kind, config) in active_integrations(input.pool, org_id).await {
        if let Some(adapter) = build_adapter(&kind) {
            // Skip if we already linked this issue to this kind —
            // covers the regression-after-resolve case where the
            // event re-arrives and `is_new=false`, but also defends
            // against retries from re-ingested batches.
            if is_already_linked(input.pool, input.issue_id, &kind).await {
                continue;
            }
            match adapter.create_issue(&config, &ctx).await {
                Ok(ext) => {
                    if let Err(e) =
                        record_link(input.pool, input.issue_id, &kind, &ext.external_id, &ext.external_url).await
                    {
                        tracing::warn!(error = %e, issue = %input.issue_id, %kind, "store link failed");
                    } else {
                        tracing::info!(issue = %input.issue_id, %kind, external = %ext.external_id, "linked");
                    }
                }
                Err(IntegrationError::NotConfigured) => {
                    // Adapter not configured (env var missing); skip.
                }
                Err(e) => {
                    tracing::warn!(error = %e, %kind, issue = %input.issue_id, "create_issue failed");
                }
            }
        }
    }
}

/// Resolved / regressed: update every existing link for this issue.
/// `event` decides what message the adapter posts.
pub async fn on_status_change(
    pool: &PgPool,
    issue_id: Uuid,
    event: IssueLifecycleEvent,
) {
    let links: Vec<(String, String)> = sqlx::query_as(
        "SELECT integration_kind, external_id FROM issue_integration_links WHERE issue_id = $1",
    )
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if links.is_empty() {
        return;
    }

    let configs = resolve_configs_for_issue(pool, issue_id).await;
    for (kind, external_id) in links {
        let Some(config) = configs.get(&kind) else {
            continue;
        };
        let Some(adapter) = build_adapter(&kind) else {
            continue;
        };
        if let Err(e) = adapter.update_status(config, &external_id, event).await {
            tracing::warn!(error = %e, %kind, %issue_id, "update_status failed");
        }
    }
}

// ───────────────────── adapter registry helpers ──────────────────────

fn build_adapter(kind: &str) -> Option<Box<dyn IntegrationAdapter>> {
    match kind {
        "linear" => LinearAdapter::from_env().map(|a| Box::new(a) as Box<dyn IntegrationAdapter>),
        _ => None,
    }
}

// ───────────────────── DB helpers ────────────────────────────────────

async fn resolve_org_id(pool: &PgPool, project_id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar::<_, Uuid>("SELECT org_id FROM projects WHERE id = $1")
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

async fn resolve_org_slug(pool: &PgPool, org_id: Uuid) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT slug FROM orgs WHERE id = $1")
        .bind(org_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

async fn active_integrations(pool: &PgPool, org_id: Uuid) -> Vec<(String, JsonValue)> {
    sqlx::query_as::<_, (String, JsonValue)>(
        "SELECT kind, config FROM integrations \
         WHERE org_id = $1 AND revoked_at IS NULL",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

async fn is_already_linked(pool: &PgPool, issue_id: Uuid, kind: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM issue_integration_links \
         WHERE issue_id = $1 AND integration_kind = $2",
    )
    .bind(issue_id)
    .bind(kind)
    .fetch_one(pool)
    .await
    .map(|c| c > 0)
    .unwrap_or(false)
}

async fn record_link(
    pool: &PgPool,
    issue_id: Uuid,
    kind: &str,
    external_id: &str,
    external_url: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO issue_integration_links \
            (issue_id, integration_kind, external_id, external_url) \
         VALUES ($1, $2, $3, $4) \
         ON CONFLICT (issue_id, integration_kind) DO NOTHING",
    )
    .bind(issue_id)
    .bind(kind)
    .bind(external_id)
    .bind(external_url)
    .execute(pool)
    .await?;
    Ok(())
}

async fn resolve_configs_for_issue(
    pool: &PgPool,
    issue_id: Uuid,
) -> std::collections::HashMap<String, JsonValue> {
    let rows: Vec<(String, JsonValue)> = sqlx::query_as(
        "SELECT i.kind, i.config \
         FROM integrations i \
         JOIN issues iss ON iss.project_id IN ( \
             SELECT id FROM projects WHERE org_id = i.org_id) \
         WHERE iss.id = $1 AND i.revoked_at IS NULL",
    )
    .bind(issue_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter().collect()
}

fn build_context<'a>(
    input: &'a DispatchInput<'a>,
    org_slug: &str,
    event_count: i64,
) -> IssueContext {
    IssueContext {
        issue_id: input.issue_id,
        project_id: input.project_id,
        error_type: input.error_type.to_string(),
        error_message: input.error_message.to_string(),
        release: input.release.to_string(),
        environment: input.environment.to_string(),
        url: format!(
            "{base}/org/{slug}/issues/{id}",
            base = input.base_url.trim_end_matches('/'),
            slug = org_slug,
            id = input.issue_id,
        ),
        event_count,
        crash_site: None,
    }
}
