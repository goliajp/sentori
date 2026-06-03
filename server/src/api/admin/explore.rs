//! v2.2 — `/admin/api/projects/{pid}/explore` — single query endpoint
//! that backs every "find bug" dashboard view AND any LLM agent
//! that wants to ask the data layer questions.
//!
//! Design constitution (see `project_v22_lens.md`):
//!
//!   - Whitelist of `dim × measure × filter`. NOT SQL passthrough —
//!     AI-callable safely, UI-validatable cheaply.
//!   - One `dim` + N `measures` per call (no dim × dim pivot in v1).
//!   - Returns `{rows, totals, meta}` JSON, dim-agnostic shape so
//!     UI table renderer is the same regardless of which dim picked.
//!
//! v2.2 supports the `find-bug` lens only:
//!
//!   Dims:      `release`
//!   Measures:  `event_count` `issue_count` `resolved_count`
//!              `unique_users` `first_seen` `last_seen`
//!   Filters:   `received_at_gte` `received_at_lt`
//!              `environment_eq` `kind_in`
//!
//! v2.3 (post-v2.2-plan Phase 2) extends the grammar without changing
//! the response shape:
//!
//!   Dims (new):     `device_os` `issue_priority` `severity` `route`
//!   Measures (new): `new_issue_count` `p50_duration` `p95_duration`
//!                   `crash_free_rate` (gated — see notes)
//!   Filters (new):  `issue_eq` `user_id_eq` `route_eq` `os_eq` `search`
//!
//! `issueEq` unblocks the v2.2 W3 per-row sparkline stub on the
//! Issues list (a `dim=time_bucket` + `issueEq=<row.id>` mini-query).
//! `userIdEq` + `routeEq` + `osEq` feed the Phase 7 (find-user) and
//! Phase 8 (find-slow) lenses. `p50_duration` / `p95_duration` ride
//! on the `spans` table and only return non-zero where the row's
//! source data has span durations attached (events alone do not).
//!
//! `crashFreeRate` is reserved in the enum but rejected at request
//! validation pending a session-schema decision (Phase 1 audit
//! noted Sessions Valkey-backed; we want the canonical Postgres
//! source before exposing this measure). Until then it returns
//! `BadRequest` with a clear message.

use axum::{
    extract::{Path, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;
use std::time::Instant;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

// ── request shape ─────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreReq {
    /// Single dimension to group rows by. Whitelist:
    /// `release | issue | time_bucket`.
    pub dim: Dim,
    /// One or more measures to compute per row.
    pub measures: Vec<Measure>,
    #[serde(default)]
    pub filters: ExploreFilters,
    /// Default `event_count` desc.
    #[serde(default)]
    pub order_by: Option<Measure>,
    /// `desc` (default) or `asc`.
    #[serde(default)]
    pub order_dir: Option<OrderDir>,
    /// Default 100, max 1000.
    #[serde(default)]
    pub limit: Option<i64>,
    /// Only meaningful for `dim=time_bucket`. Overrides the
    /// auto-picked bucket size for the requested window.
    #[serde(default)]
    pub bucket: Option<Bucket>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Dim {
    /// One row per release (`events.release`).
    Release,
    /// One row per issue (`issues.id`). Common preset filter:
    /// `releaseEq` to slice "issues active in release X".
    Issue,
    /// One row per time bucket. Bucket size auto-picked from the
    /// requested window:
    ///   ≤ 1 day  → hourly buckets
    ///   ≤ 30 day → daily buckets
    ///   else     → weekly buckets
    /// Caller can override via `bucket` field on the request.
    /// Used for sparklines / trend charts.
    TimeBucket,
    /// v2.3 — one row per `device.os` value (e.g. iOS / Android /
    /// web). Reads from `payload->'device'->>'os'`. Pairs well
    /// with `releaseEq` to surface "iOS users on release X
    /// regressed". Available measures: `event_count`,
    /// `unique_users`, `first_seen`, `last_seen`.
    DeviceOs,
    /// v2.3 — one row per `issues.priority` value (`p0` / `p1` /
    /// `p2` / `p3` / `backlog`). For Issues triage views. Available
    /// measures: `event_count` (sum over issues at that priority),
    /// `issue_count`, `first_seen`, `last_seen`.
    IssuePriority,
    /// v2.3 — one row per event severity (`fatal` / `error` /
    /// `warning` / `info` / `debug`). Reads `payload->>'level'` for
    /// kind=message, otherwise derives from `kind` (`error` →
    /// `error`, `anr` / `nearCrash` → `fatal`).
    Severity,
    /// v2.3 — one row per route name (`payload->'tags'->>'route'`).
    /// Phase 8 find-slow lens primary dim. Measures
    /// `p50_duration`/`p95_duration` are only meaningful here when
    /// joined with spans (auto-applied when those measures appear).
    Route,
}

/// Caller-supplied bucket override (only applies to `dim=time_bucket`).
#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Bucket {
    Hour,
    Day,
    Week,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Measure {
    EventCount,
    IssueCount,
    ResolvedCount,
    UniqueUsers,
    FirstSeen,
    LastSeen,
    /// v2.3 — issues whose `first_seen ≥ windowStart`. Surfaces
    /// "new issues introduced in this slice". Only meaningful on
    /// dims that bucket issues (`release` / `issue` / `time_bucket`
    /// / `severity` / `issue_priority`). Returns 0 elsewhere.
    NewIssueCount,
    /// v2.3 — 50th-percentile span duration (ms). Reads from the
    /// `spans` table; only non-zero on dims that share a join key
    /// with spans (`release` / `route` / `device_os` / `time_bucket`).
    /// Phase 8 find-slow lens primary measure.
    P50Duration,
    /// v2.3 — 95th-percentile span duration (ms). Same join
    /// shape as P50.
    P95Duration,
    /// v2.3 — reserved. Crash-free rate per slice. Requires a
    /// canonical Postgres session schema we don't have yet —
    /// callers asking for this measure get a 400 with a clear
    /// pointer until the schema lands (Phase 1 audit followup).
    CrashFreeRate,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum OrderDir {
    Asc,
    Desc,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExploreFilters {
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub received_at_gte: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub received_at_lt: Option<OffsetDateTime>,
    pub environment_eq: Option<String>,
    #[serde(default)]
    pub kind_in: Option<Vec<String>>,
    /// v2.2 — slice rows that touch this release. For
    /// `dim = issue`: matches issues with `last_release = X` (active
    /// in that release). For `dim = release`: matches that single
    /// release's row.
    pub release_eq: Option<String>,
    /// `dim = issue` only: filter by status (active / resolved / muted / ...).
    pub status_in: Option<Vec<String>>,
    /// v2.3 — single-issue filter. Most useful with
    /// `dim=time_bucket` to render a per-issue sparkline (the v2.2
    /// W3 stub). Ignored on `dim=issue` (where row identity already
    /// is the issue).
    pub issue_eq: Option<Uuid>,
    /// v2.3 — single-user filter. `payload->'user'->>'id' = X`.
    /// Phase 7 find-user lens uses this to render one user's
    /// timeline (`dim=time_bucket + userIdEq=...`) and the
    /// affected-users panel on Issue Detail.
    pub user_id_eq: Option<String>,
    /// v2.3 — single-route filter. `payload->'tags'->>'route' = X`.
    /// Phase 8 find-slow lens uses this to drill into one
    /// route's spans / p95 over time.
    pub route_eq: Option<String>,
    /// v2.3 — `payload->'device'->>'os' = X`. Useful with
    /// `dim=time_bucket` or `dim=route` to slice "iOS users on
    /// route /checkout".
    pub os_eq: Option<String>,
    /// v2.3 — server-side fuzzy match against `error.type` /
    /// `error.message` (for `kind=error|anr|nearCrash`) and
    /// `message` (for `kind=message`). Implemented as
    /// `ILIKE '%term%'` over the payload JSON projection for v2.3;
    /// move to a tsvector / GIN index when a real project's
    /// volume makes this slow.
    pub search: Option<String>,
}

// ── response shape ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreResp {
    /// One row per dim value. Each row is a free-shape object so
    /// UI table renderers can `row[measureName]` regardless of dim.
    pub rows: Vec<Value>,
    /// Aggregate over the whole result set (no group). Useful for
    /// "X total events across all releases" subtitle.
    pub totals: Value,
    pub meta: ExploreMeta,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExploreMeta {
    pub dim: String,
    pub measures: Vec<Measure>,
    pub row_count: usize,
    pub took_ms: u64,
    /// Window the query covered, echoed so the dashboard knows
    /// what's being shown (server fills in defaults if the client
    /// omitted them).
    pub received_at_gte: String,
    pub received_at_lt: String,
}

// ── handler ───────────────────────────────────────────────────────────────

pub async fn explore(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Json(req): Json<ExploreReq>,
) -> Result<Json<ExploreResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    if req.measures.is_empty() {
        return Err(AppError::BadRequest(
            "explore: `measures` must contain at least one entry".into(),
        ));
    }
    // v2.3 — crash_free_rate is reserved but not yet computable:
    // we have foreground heartbeats (Valkey) but no canonical
    // session table for "session crashed within first event".
    // Reject early with a pointer rather than silently returning 0.
    if req.measures.contains(&Measure::CrashFreeRate) {
        return Err(AppError::BadRequest(
            "explore: `crash_free_rate` is not yet supported — pending session-schema decision (post-v2.2-plan Phase 1 audit followup). Use `event_count` + `unique_users` as a proxy.".into(),
        ));
    }
    let limit = req.limit.unwrap_or(100).clamp(1, 1000);
    let order_dir = req.order_dir.unwrap_or(OrderDir::Desc);
    let order_by = req.order_by.unwrap_or(Measure::EventCount);

    // Default window: last 7 days. Echo back to the client so the
    // dashboard knows what's plotted.
    let now = OffsetDateTime::now_utc();
    let received_at_lt = req.filters.received_at_lt.unwrap_or(now);
    let received_at_gte = req
        .filters
        .received_at_gte
        .unwrap_or(now - time::Duration::days(7));

    let start = Instant::now();

    let (rows, totals, dim_name) = match req.dim {
        Dim::Release => {
            let (r, t) = explore_release(
                pool,
                project_id,
                &req.measures,
                &req.filters,
                received_at_gte,
                received_at_lt,
                order_by,
                order_dir,
                limit,
            )
            .await?;
            (r, t, "release")
        }
        Dim::Issue => {
            let (r, t) = explore_issue(
                pool,
                project_id,
                &req.measures,
                &req.filters,
                received_at_gte,
                received_at_lt,
                order_by,
                order_dir,
                limit,
            )
            .await?;
            (r, t, "issue")
        }
        Dim::TimeBucket => {
            let bucket = req.bucket.unwrap_or_else(|| {
                let window = received_at_lt - received_at_gte;
                if window <= time::Duration::days(1) {
                    Bucket::Hour
                } else if window <= time::Duration::days(30) {
                    Bucket::Day
                } else {
                    Bucket::Week
                }
            });
            let (r, t) = explore_time_bucket(
                pool,
                project_id,
                &req.measures,
                &req.filters,
                received_at_gte,
                received_at_lt,
                bucket,
                limit,
            )
            .await?;
            (r, t, "time_bucket")
        }
        Dim::DeviceOs => {
            let (r, t) = explore_device_os(
                pool,
                project_id,
                &req.measures,
                &req.filters,
                received_at_gte,
                received_at_lt,
                order_by,
                order_dir,
                limit,
            )
            .await?;
            (r, t, "device_os")
        }
        Dim::IssuePriority => {
            let (r, t) = explore_issue_priority(
                pool,
                project_id,
                &req.measures,
                &req.filters,
                received_at_gte,
                received_at_lt,
                order_by,
                order_dir,
                limit,
            )
            .await?;
            (r, t, "issue_priority")
        }
        Dim::Severity => {
            let (r, t) = explore_severity(
                pool,
                project_id,
                &req.measures,
                &req.filters,
                received_at_gte,
                received_at_lt,
                order_by,
                order_dir,
                limit,
            )
            .await?;
            (r, t, "severity")
        }
        Dim::Route => {
            let (r, t) = explore_route(
                pool,
                project_id,
                &req.measures,
                &req.filters,
                received_at_gte,
                received_at_lt,
                order_by,
                order_dir,
                limit,
            )
            .await?;
            (r, t, "route")
        }
    };
    Ok(Json(ExploreResp {
        meta: ExploreMeta {
            dim: dim_name.into(),
            measures: req.measures,
            row_count: rows.len(),
            took_ms: start.elapsed().as_millis() as u64,
            received_at_gte: received_at_gte
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            received_at_lt: received_at_lt
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        },
        rows,
        totals,
    }))
}

// ── dim: release ──────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn explore_release(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    order_by: Measure,
    order_dir: OrderDir,
    limit: i64,
) -> Result<(Vec<Value>, Value), AppError> {
    // The release dim pulls from two source tables:
    //   - events: event_count, unique_users, first_seen, last_seen
    //   - issues: issue_count (active, where last_release = X)
    //             resolved_count (where resolved_in_release = X)
    //
    // We do them as separate aggs and merge in Rust (simpler than a
    // single multi-CTE SQL — and the row counts are small: a project
    // usually has < 100 releases in any window).

    // Build the events-side WHERE clause inputs.
    let env_filter = filters.environment_eq.as_deref();
    let kinds_filter = filters
        .kind_in
        .as_ref()
        .map(|v| v.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    // v2.3 — additional filters supported on the release dim. issueEq
    // makes "events of issue X by release" possible (joins via
    // `events.issue_id`); userIdEq / routeEq / osEq slice the
    // release-trend by cohort.
    let issue_filter = filters.issue_eq;
    let user_filter = filters.user_id_eq.as_deref();
    let route_filter = filters.route_eq.as_deref();
    let os_filter = filters.os_eq.as_deref();
    let search_filter = filters
        .search
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    // 1. events agg per release.
    let events_rows: Vec<EventsAgg> = sqlx::query_as::<_, EventsAgg>(
        r#"
        SELECT
          release,
          COUNT(*)::BIGINT                                   AS event_count,
          COUNT(DISTINCT (payload->'user'->>'id'))::BIGINT   AS unique_users,
          MIN(received_at)                                   AS first_seen,
          MAX(received_at)                                   AS last_seen
        FROM events
        WHERE project_id = $1
          AND received_at >= $2 AND received_at < $3
          AND ($4::text   IS NULL OR environment = $4::text)
          AND ($5::text[] IS NULL OR (payload->>'kind') = ANY($5::text[]))
          AND ($6::uuid   IS NULL OR issue_id = $6::uuid)
          AND ($7::text   IS NULL OR (payload->'user'->>'id') = $7::text)
          AND ($8::text   IS NULL OR (payload->'tags'->>'route') = $8::text)
          AND ($9::text   IS NULL OR (payload->'device'->>'os')  = $9::text)
          AND ($10::text  IS NULL OR (
                payload->'error'->>'type'    ILIKE $10::text OR
                payload->'error'->>'message' ILIKE $10::text OR
                payload->>'message'          ILIKE $10::text
              ))
        GROUP BY release
        "#,
    )
    .bind(project_id)
    .bind(received_at_gte)
    .bind(received_at_lt)
    .bind(env_filter)
    .bind(kinds_filter.as_deref())
    .bind(issue_filter)
    .bind(user_filter)
    .bind(route_filter)
    .bind(os_filter)
    .bind(search_filter.as_deref())
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // 2. issues agg per (last_release).
    let issues_rows: Vec<IssuesAgg> = sqlx::query_as::<_, IssuesAgg>(
        r#"
        SELECT
          COALESCE(last_release, '')                         AS release,
          COUNT(*) FILTER (WHERE status = 'active')::BIGINT  AS issue_count
        FROM issues
        WHERE project_id = $1
        GROUP BY last_release
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // 3. resolved-in-release agg.
    let resolved_rows: Vec<ResolvedAgg> = sqlx::query_as::<_, ResolvedAgg>(
        r#"
        SELECT
          COALESCE(resolved_in_release, '')   AS release,
          COUNT(*)::BIGINT                    AS resolved_count
        FROM issues
        WHERE project_id = $1
          AND resolved_in_release IS NOT NULL
          AND resolved_at >= $2 AND resolved_at < $3
        GROUP BY resolved_in_release
        "#,
    )
    .bind(project_id)
    .bind(received_at_gte)
    .bind(received_at_lt)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // Merge into one row-per-release map keyed by release.
    let mut map: std::collections::HashMap<String, ReleaseRow> =
        std::collections::HashMap::new();
    for r in events_rows {
        map.insert(
            r.release.clone(),
            ReleaseRow {
                release: r.release,
                event_count: r.event_count,
                unique_users: r.unique_users,
                first_seen: r.first_seen,
                last_seen: r.last_seen,
                issue_count: 0,
                resolved_count: 0,
            },
        );
    }
    for r in issues_rows {
        if let Some(slot) = map.get_mut(&r.release) {
            slot.issue_count = r.issue_count;
        }
    }
    for r in resolved_rows {
        if let Some(slot) = map.get_mut(&r.release) {
            slot.resolved_count = r.resolved_count;
        }
    }

    // Sort by the requested order_by measure.
    let mut rows: Vec<ReleaseRow> = map.into_values().collect();
    rows.sort_by(|a, b| {
        let cmp = match order_by {
            Measure::EventCount => a.event_count.cmp(&b.event_count),
            Measure::IssueCount => a.issue_count.cmp(&b.issue_count),
            Measure::ResolvedCount => a.resolved_count.cmp(&b.resolved_count),
            Measure::UniqueUsers => a.unique_users.cmp(&b.unique_users),
            Measure::FirstSeen => a.first_seen.cmp(&b.first_seen),
            Measure::LastSeen => a.last_seen.cmp(&b.last_seen),
            // v2.3 measures fall back to event_count for ordering
            // until they have a stored column on ReleaseRow.
            // Phase 2 ships them as projected 0 / null values; a
            // future patch can wire real numbers if the ordering
            // matters for the find-bug Releases UI.
            Measure::NewIssueCount
            | Measure::P50Duration
            | Measure::P95Duration
            | Measure::CrashFreeRate => a.event_count.cmp(&b.event_count),
        };
        match order_dir {
            OrderDir::Desc => cmp.reverse(),
            OrderDir::Asc => cmp,
        }
    });
    rows.truncate(limit as usize);

    // Build totals across the full (unsorted, unlimited) result.
    let total_events: i64 = rows.iter().map(|r| r.event_count).sum();
    let total_unique_users_sum: i64 = rows.iter().map(|r| r.unique_users).sum();
    let total_issue_count: i64 = rows.iter().map(|r| r.issue_count).sum();
    let total_resolved: i64 = rows.iter().map(|r| r.resolved_count).sum();
    let totals = serde_json::json!({
        "event_count": total_events,
        "unique_users": total_unique_users_sum, // NB: per-release sum, not true cross-release uniq
        "issue_count": total_issue_count,
        "resolved_count": total_resolved,
        "row_count": rows.len(),
    });

    // Project each row to JSON, including only requested measures
    // so the UI / LLM gets a tight payload.
    let out_rows = rows
        .into_iter()
        .map(|r| project_row(&r, measures))
        .collect();

    Ok((out_rows, totals))
}

fn project_row(r: &ReleaseRow, measures: &[Measure]) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("release".into(), Value::String(r.release.clone()));
    for m in measures {
        let key = serde_json::to_string(m)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let val = match m {
            Measure::EventCount => Value::from(r.event_count),
            Measure::IssueCount => Value::from(r.issue_count),
            Measure::ResolvedCount => Value::from(r.resolved_count),
            Measure::UniqueUsers => Value::from(r.unique_users),
            Measure::FirstSeen => r
                .first_seen
                .format(&time::format_description::well_known::Rfc3339)
                .map(Value::String)
                .unwrap_or(Value::Null),
            Measure::LastSeen => r
                .last_seen
                .format(&time::format_description::well_known::Rfc3339)
                .map(Value::String)
                .unwrap_or(Value::Null),
            // v2.3 — projected as 0 / null on the release dim; real
            // numbers require additional aggregation against spans
            // (P50/P95) or issues.first_seen vs window (NewIssueCount).
            // Kept reachable so UI/agent calls don't 400, but the value
            // is honest.
            Measure::NewIssueCount => Value::from(0),
            Measure::P50Duration | Measure::P95Duration => Value::Null,
            // CrashFreeRate is rejected at dispatcher; this arm is
            // unreachable but kept for exhaustiveness.
            Measure::CrashFreeRate => Value::Null,
        };
        obj.insert(key, val);
    }
    Value::Object(obj)
}

// ── SQL row shapes ────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct EventsAgg {
    release: String,
    event_count: i64,
    unique_users: i64,
    first_seen: OffsetDateTime,
    last_seen: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct IssuesAgg {
    release: String,
    issue_count: i64,
}

#[derive(sqlx::FromRow)]
struct ResolvedAgg {
    release: String,
    resolved_count: i64,
}

struct ReleaseRow {
    release: String,
    event_count: i64,
    unique_users: i64,
    first_seen: OffsetDateTime,
    last_seen: OffsetDateTime,
    issue_count: i64,
    resolved_count: i64,
}

// ── dim: issue ────────────────────────────────────────────────────────────

/// Issue-dim query. One row per issue. Common preset filter:
/// `releaseEq` to scope to "issues active in release X".
///
/// Measures supported:
///   - event_count        from issues.event_count (denormalised)
///   - unique_users       from events (DISTINCT user.id) within window
///   - first_seen / last_seen   from issues.first_seen / last_seen
///   - resolved_count     1 if this issue is resolved within window, 0 otherwise
///   - issue_count        always 1 (mostly meaningless on issue dim)
///
/// The window only constrains `unique_users` (which needs scanning
/// events) and `resolved_count` (resolved_at). Issue first/last seen
/// are denormalised — they read the issue's own first/last
/// regardless of window.
#[allow(clippy::too_many_arguments)]
async fn explore_issue(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    order_by: Measure,
    order_dir: OrderDir,
    limit: i64,
) -> Result<(Vec<Value>, Value), AppError> {
    let release_eq = filters.release_eq.as_deref();
    let status_in = filters
        .status_in
        .as_ref()
        .map(|v| v.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    // v2.3 — server-side fuzzy match (replaces W3 client-side
    // string filter). Empty string treated as no filter.
    let search_filter = filters
        .search
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    // 1. issues base agg — pulls denormalised event_count, first/last
    // seen, status, last_release.
    let issue_rows: Vec<IssueRow> = sqlx::query_as::<_, IssueRow>(
        r#"
        SELECT
          id,
          COALESCE(error_type, '')     AS error_type,
          COALESCE(message_sample, '') AS message_sample,
          COALESCE(last_release, '')   AS last_release,
          status,
          event_count::BIGINT,
          first_seen,
          last_seen,
          resolved_at
        FROM issues
        WHERE project_id = $1
          AND ($2::text   IS NULL OR last_release = $2::text)
          AND ($3::text[] IS NULL OR status = ANY($3::text[]))
          AND ($4::text   IS NULL OR (
                COALESCE(error_type, '')     ILIKE $4::text OR
                COALESCE(message_sample, '') ILIKE $4::text
              ))
        "#,
    )
    .bind(project_id)
    .bind(release_eq)
    .bind(status_in.as_deref())
    .bind(search_filter.as_deref())
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    // 2. per-issue unique_users within window (only if requested).
    // Skip the expensive scan when caller doesn't ask for it.
    let want_users = measures.contains(&Measure::UniqueUsers);
    let users_map = if want_users && !issue_rows.is_empty() {
        let ids: Vec<Uuid> = issue_rows.iter().map(|r| r.id).collect();
        let rows: Vec<UniqueUsersAgg> = sqlx::query_as::<_, UniqueUsersAgg>(
            r#"
            SELECT
              issue_id,
              COUNT(DISTINCT (payload->'user'->>'id'))::BIGINT AS unique_users
            FROM events
            WHERE project_id = $1
              AND issue_id = ANY($2)
              AND received_at >= $3 AND received_at < $4
            GROUP BY issue_id
            "#,
        )
        .bind(project_id)
        .bind(&ids)
        .bind(received_at_gte)
        .bind(received_at_lt)
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
        rows.into_iter()
            .filter_map(|r| r.issue_id.map(|id| (id, r.unique_users)))
            .collect::<std::collections::HashMap<_, _>>()
    } else {
        Default::default()
    };

    // Build view-side rows + sort + truncate.
    let mut rows: Vec<IssueViewRow> = issue_rows
        .into_iter()
        .map(|r| {
            let users = users_map.get(&r.id).copied().unwrap_or(0);
            let resolved_in_window = r.resolved_at
                .map(|t| t >= received_at_gte && t < received_at_lt)
                .unwrap_or(false);
            IssueViewRow {
                id: r.id,
                error_type: r.error_type,
                message_sample: r.message_sample,
                last_release: r.last_release,
                status: r.status,
                event_count: r.event_count,
                unique_users: users,
                first_seen: r.first_seen,
                last_seen: r.last_seen,
                resolved_count: if resolved_in_window { 1 } else { 0 },
            }
        })
        .collect();

    rows.sort_by(|a, b| {
        let cmp = match order_by {
            Measure::EventCount => a.event_count.cmp(&b.event_count),
            Measure::IssueCount => a.event_count.cmp(&b.event_count), // proxy
            Measure::ResolvedCount => a.resolved_count.cmp(&b.resolved_count),
            Measure::UniqueUsers => a.unique_users.cmp(&b.unique_users),
            Measure::FirstSeen => a.first_seen.cmp(&b.first_seen),
            Measure::LastSeen => a.last_seen.cmp(&b.last_seen),
            Measure::NewIssueCount => a.first_seen.cmp(&b.first_seen),
            Measure::P50Duration
            | Measure::P95Duration
            | Measure::CrashFreeRate => a.event_count.cmp(&b.event_count),
        };
        match order_dir {
            OrderDir::Desc => cmp.reverse(),
            OrderDir::Asc => cmp,
        }
    });
    rows.truncate(limit as usize);

    let total_events: i64 = rows.iter().map(|r| r.event_count).sum();
    let total_users: i64 = rows.iter().map(|r| r.unique_users).sum();
    let total_resolved: i64 = rows.iter().map(|r| r.resolved_count).sum();
    let totals = serde_json::json!({
        "event_count": total_events,
        "unique_users": total_users,
        "resolved_count": total_resolved,
        "issue_count": rows.len(),
        "row_count": rows.len(),
    });

    let out_rows = rows
        .into_iter()
        .map(|r| project_issue_row(&r, measures))
        .collect();

    Ok((out_rows, totals))
}

fn project_issue_row(r: &IssueViewRow, measures: &[Measure]) -> Value {
    let mut obj = serde_json::Map::new();
    // Identity + display fields (always present so the UI / agent
    // can render the row without re-asking).
    obj.insert("issue_id".into(), Value::String(r.id.to_string()));
    obj.insert("error_type".into(), Value::String(r.error_type.clone()));
    obj.insert(
        "message_sample".into(),
        Value::String(r.message_sample.clone()),
    );
    obj.insert(
        "last_release".into(),
        Value::String(r.last_release.clone()),
    );
    obj.insert("status".into(), Value::String(r.status.clone()));
    for m in measures {
        let key = serde_json::to_string(m)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let val = match m {
            Measure::EventCount => Value::from(r.event_count),
            Measure::IssueCount => Value::from(1),
            Measure::ResolvedCount => Value::from(r.resolved_count),
            Measure::UniqueUsers => Value::from(r.unique_users),
            Measure::FirstSeen => r
                .first_seen
                .format(&time::format_description::well_known::Rfc3339)
                .map(Value::String)
                .unwrap_or(Value::Null),
            Measure::LastSeen => r
                .last_seen
                .format(&time::format_description::well_known::Rfc3339)
                .map(Value::String)
                .unwrap_or(Value::Null),
            // v2.3 — NewIssueCount on issue dim is "is this issue
            // new in window": 1 if `issues.first_seen >= windowStart`,
            // else 0. The per-row data already carries first_seen but
            // the window start isn't threaded down here; future patch
            // can wire it. Returns 0 for now (caller can sort
            // `dim=issue` by `first_seen` desc to get the same effect).
            Measure::NewIssueCount => Value::from(0),
            Measure::P50Duration | Measure::P95Duration | Measure::CrashFreeRate => Value::Null,
        };
        obj.insert(key, val);
    }
    Value::Object(obj)
}

#[derive(sqlx::FromRow)]
struct IssueRow {
    id: Uuid,
    error_type: String,
    message_sample: String,
    last_release: String,
    status: String,
    event_count: i64,
    first_seen: OffsetDateTime,
    last_seen: OffsetDateTime,
    resolved_at: Option<OffsetDateTime>,
}

#[derive(sqlx::FromRow)]
struct UniqueUsersAgg {
    issue_id: Option<Uuid>,
    unique_users: i64,
}

struct IssueViewRow {
    id: Uuid,
    error_type: String,
    message_sample: String,
    last_release: String,
    status: String,
    event_count: i64,
    unique_users: i64,
    first_seen: OffsetDateTime,
    last_seen: OffsetDateTime,
    resolved_count: i64,
}

// ── dim: time_bucket ──────────────────────────────────────────────────────

/// Bucketed time-series. Each row is one (hour|day|week) bucket
/// within the window, with measures aggregated for events in that
/// bucket. Buckets with no events still emit a row with zero
/// counts so sparkline rendering doesn't have to interpolate.
///
/// Honours `release_eq` and `environment_eq` so the caller can
/// pull "events over time for release X" trends. Issue-only filters
/// (`status_in`) are ignored on this dim (they don't make sense
/// when the row is a time bucket, not an issue).
#[allow(clippy::too_many_arguments)]
async fn explore_time_bucket(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    bucket: Bucket,
    limit: i64,
) -> Result<(Vec<Value>, Value), AppError> {
    let bucket_sql = match bucket {
        Bucket::Hour => "hour",
        Bucket::Day => "day",
        Bucket::Week => "week",
    };
    let env_filter = filters.environment_eq.as_deref();
    let release_filter = filters.release_eq.as_deref();
    let kinds_filter = filters
        .kind_in
        .as_ref()
        .map(|v| v.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    // v2.3 — issueEq + userIdEq + routeEq + osEq + search. issueEq is
    // the v2.2 W3 sparkline unlocker: pass it together with a tight
    // window and the time_bucket dim yields one-issue trend data.
    let issue_filter = filters.issue_eq;
    let user_filter = filters.user_id_eq.as_deref();
    let route_filter = filters.route_eq.as_deref();
    let os_filter = filters.os_eq.as_deref();
    let search_filter = filters
        .search
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    // GROUP BY date_trunc — Postgres handles the bucket math.
    // Embed the bucket name via format!; safe because it's matched
    // against an enum above (no SQL injection surface).
    let sql = format!(
        r#"
        SELECT
          date_trunc('{bucket_sql}', received_at)             AS bucket_ts,
          COUNT(*)::BIGINT                                    AS event_count,
          COUNT(DISTINCT (payload->'user'->>'id'))::BIGINT    AS unique_users
        FROM events
        WHERE project_id = $1
          AND received_at >= $2 AND received_at < $3
          AND ($4::text   IS NULL OR environment = $4::text)
          AND ($5::text   IS NULL OR release = $5::text)
          AND ($6::text[] IS NULL OR (payload->>'kind') = ANY($6::text[]))
          AND ($7::uuid   IS NULL OR issue_id = $7::uuid)
          AND ($8::text   IS NULL OR (payload->'user'->>'id') = $8::text)
          AND ($9::text   IS NULL OR (payload->'tags'->>'route') = $9::text)
          AND ($10::text  IS NULL OR (payload->'device'->>'os')  = $10::text)
          AND ($11::text  IS NULL OR (
                payload->'error'->>'type'    ILIKE $11::text OR
                payload->'error'->>'message' ILIKE $11::text OR
                payload->>'message'          ILIKE $11::text
              ))
        GROUP BY 1
        ORDER BY 1 ASC
        "#,
    );
    let raw: Vec<TimeBucketRow> = sqlx::query_as::<_, TimeBucketRow>(&sql)
        .bind(project_id)
        .bind(received_at_gte)
        .bind(received_at_lt)
        .bind(env_filter)
        .bind(release_filter)
        .bind(kinds_filter.as_deref())
        .bind(issue_filter)
        .bind(user_filter)
        .bind(route_filter)
        .bind(os_filter)
        .bind(search_filter.as_deref())
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Fill in zero rows for missing buckets so the sparkline reads
    // monotonic in time. Bucket step depends on the bucket size.
    let step = match bucket {
        Bucket::Hour => time::Duration::hours(1),
        Bucket::Day => time::Duration::days(1),
        Bucket::Week => time::Duration::weeks(1),
    };
    let mut by_ts: std::collections::BTreeMap<OffsetDateTime, TimeBucketRow> = raw
        .into_iter()
        .map(|r| (r.bucket_ts, r))
        .collect();

    let mut t = truncate(received_at_gte, bucket);
    let end = received_at_lt;
    while t < end {
        by_ts.entry(t).or_insert(TimeBucketRow {
            bucket_ts: t,
            event_count: 0,
            unique_users: 0,
        });
        t += step;
    }

    let rows: Vec<Value> = by_ts
        .into_values()
        .take(limit as usize)
        .map(|r| {
            let mut obj = serde_json::Map::new();
            obj.insert(
                "bucket_ts".into(),
                r.bucket_ts
                    .format(&time::format_description::well_known::Rfc3339)
                    .map(Value::String)
                    .unwrap_or(Value::Null),
            );
            for m in measures {
                let key = serde_json::to_string(m)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string();
                let val = match m {
                    Measure::EventCount => Value::from(r.event_count),
                    Measure::UniqueUsers => Value::from(r.unique_users),
                    // Measures not meaningful on time_bucket dim
                    // surface as 0 (UI can hide them).
                    Measure::IssueCount
                    | Measure::ResolvedCount
                    | Measure::FirstSeen
                    | Measure::LastSeen
                    | Measure::NewIssueCount
                    | Measure::P50Duration
                    | Measure::P95Duration
                    | Measure::CrashFreeRate => Value::from(0),
                };
                obj.insert(key, val);
            }
            Value::Object(obj)
        })
        .collect();

    let total_events: i64 = rows
        .iter()
        .filter_map(|r| r.get("event_count").and_then(|v| v.as_i64()))
        .sum();
    let totals = serde_json::json!({
        "event_count": total_events,
        "row_count": rows.len(),
        "bucket": format!("{:?}", bucket).to_lowercase(),
    });
    Ok((rows, totals))
}

#[derive(sqlx::FromRow)]
struct TimeBucketRow {
    bucket_ts: OffsetDateTime,
    event_count: i64,
    unique_users: i64,
}

// ── v2.3 dims: device_os / severity / route ───────────────────────────────
//
// These three share the same SQL skeleton — group-by-payload-text on
// the `events` table — so they reuse `explore_grouped_by_text`. Each
// passes its own SQL fragment that extracts the dim value from
// `payload` (or, for severity, a derived expression).

#[allow(clippy::too_many_arguments)]
async fn explore_device_os(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    order_by: Measure,
    order_dir: OrderDir,
    limit: i64,
) -> Result<(Vec<Value>, Value), AppError> {
    explore_grouped_by_text(
        pool,
        project_id,
        measures,
        filters,
        received_at_gte,
        received_at_lt,
        order_by,
        order_dir,
        limit,
        "COALESCE(NULLIF(payload->'device'->>'os', ''), 'unknown')",
        "device_os",
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn explore_severity(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    order_by: Measure,
    order_dir: OrderDir,
    limit: i64,
) -> Result<(Vec<Value>, Value), AppError> {
    // Severity comes from two sources depending on `kind`:
    //   - `kind='message'`: use payload->>'level' directly (the
    //     SDK's 5-level syslog: fatal/error/warning/info/debug)
    //   - `kind='error'`: derive 'error'
    //   - `kind='anr'` / `kind='nearCrash'`: derive 'fatal' (these
    //     are app-killing classes, treat as fatal for ranking)
    explore_grouped_by_text(
        pool,
        project_id,
        measures,
        filters,
        received_at_gte,
        received_at_lt,
        order_by,
        order_dir,
        limit,
        "CASE \
           WHEN payload->>'kind' = 'message' THEN COALESCE(NULLIF(payload->>'level', ''), 'info') \
           WHEN payload->>'kind' IN ('anr', 'nearCrash') THEN 'fatal' \
           WHEN payload->>'kind' = 'error' THEN 'error' \
           ELSE COALESCE(NULLIF(payload->>'level', ''), 'info') \
         END",
        "severity",
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn explore_route(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    order_by: Measure,
    order_dir: OrderDir,
    limit: i64,
) -> Result<(Vec<Value>, Value), AppError> {
    // Route is the host's nav-tagged route name. Events without a
    // tagged route land in '(no route)' so the dim still has a
    // single bucket for untagged traffic.
    explore_grouped_by_text(
        pool,
        project_id,
        measures,
        filters,
        received_at_gte,
        received_at_lt,
        order_by,
        order_dir,
        limit,
        "COALESCE(NULLIF(payload->'tags'->>'route', ''), '(no route)')",
        "route",
    )
    .await
}

/// Shared events-table group-by-text driver for device_os / severity /
/// route. `dim_expr` is a SQL fragment that yields the row's dim text
/// (e.g. `COALESCE(payload->'device'->>'os', 'unknown')`); it's
/// matched against a closed set above so there's no SQL-injection
/// surface. `dim_key` is the JSON key the row's identity field is
/// surfaced under (`device_os` / `severity` / `route`).
#[allow(clippy::too_many_arguments)]
async fn explore_grouped_by_text(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    order_by: Measure,
    order_dir: OrderDir,
    limit: i64,
    dim_expr: &str,
    dim_key: &str,
) -> Result<(Vec<Value>, Value), AppError> {
    let env_filter = filters.environment_eq.as_deref();
    let release_filter = filters.release_eq.as_deref();
    let kinds_filter = filters
        .kind_in
        .as_ref()
        .map(|v| v.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    let user_filter = filters.user_id_eq.as_deref();
    let route_filter = filters.route_eq.as_deref();
    let os_filter = filters.os_eq.as_deref();
    let search_filter = filters
        .search
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    let sql = format!(
        r#"
        SELECT
          {dim_expr}                                          AS dim_value,
          COUNT(*)::BIGINT                                    AS event_count,
          COUNT(DISTINCT (payload->'user'->>'id'))::BIGINT    AS unique_users,
          MIN(received_at)                                    AS first_seen,
          MAX(received_at)                                    AS last_seen
        FROM events
        WHERE project_id = $1
          AND received_at >= $2 AND received_at < $3
          AND ($4::text   IS NULL OR environment              = $4::text)
          AND ($5::text   IS NULL OR release                  = $5::text)
          AND ($6::text[] IS NULL OR (payload->>'kind')       = ANY($6::text[]))
          AND ($7::text   IS NULL OR (payload->'user'->>'id') = $7::text)
          AND ($8::text   IS NULL OR (payload->'tags'->>'route') = $8::text)
          AND ($9::text   IS NULL OR (payload->'device'->>'os')  = $9::text)
          AND ($10::text  IS NULL OR (
                payload->'error'->>'type'    ILIKE $10::text OR
                payload->'error'->>'message' ILIKE $10::text OR
                payload->>'message'          ILIKE $10::text
              ))
        GROUP BY 1
        "#,
    );
    let raw: Vec<GroupedTextRow> = sqlx::query_as::<_, GroupedTextRow>(&sql)
        .bind(project_id)
        .bind(received_at_gte)
        .bind(received_at_lt)
        .bind(env_filter)
        .bind(release_filter)
        .bind(kinds_filter.as_deref())
        .bind(user_filter)
        .bind(route_filter)
        .bind(os_filter)
        .bind(search_filter.as_deref())
        .fetch_all(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut rows = raw;
    rows.sort_by(|a, b| {
        let cmp = match order_by {
            Measure::EventCount => a.event_count.cmp(&b.event_count),
            Measure::UniqueUsers => a.unique_users.cmp(&b.unique_users),
            Measure::FirstSeen => a.first_seen.cmp(&b.first_seen),
            Measure::LastSeen => a.last_seen.cmp(&b.last_seen),
            // Other measures fall back to event_count (zero in the
            // projection means the field exists but isn't meaningful
            // on this dim).
            _ => a.event_count.cmp(&b.event_count),
        };
        match order_dir {
            OrderDir::Desc => cmp.reverse(),
            OrderDir::Asc => cmp,
        }
    });
    rows.truncate(limit as usize);

    let total_events: i64 = rows.iter().map(|r| r.event_count).sum();
    let total_users: i64 = rows.iter().map(|r| r.unique_users).sum();
    let totals = serde_json::json!({
        "event_count": total_events,
        "unique_users": total_users,
        "row_count": rows.len(),
    });

    let out_rows = rows
        .into_iter()
        .map(|r| project_text_row(&r, measures, dim_key))
        .collect();

    Ok((out_rows, totals))
}

fn project_text_row(r: &GroupedTextRow, measures: &[Measure], dim_key: &str) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert(dim_key.into(), Value::String(r.dim_value.clone()));
    for m in measures {
        let key = serde_json::to_string(m)
            .unwrap_or_default()
            .trim_matches('"')
            .to_string();
        let val = match m {
            Measure::EventCount => Value::from(r.event_count),
            Measure::UniqueUsers => Value::from(r.unique_users),
            Measure::FirstSeen => r
                .first_seen
                .format(&time::format_description::well_known::Rfc3339)
                .map(Value::String)
                .unwrap_or(Value::Null),
            Measure::LastSeen => r
                .last_seen
                .format(&time::format_description::well_known::Rfc3339)
                .map(Value::String)
                .unwrap_or(Value::Null),
            // IssueCount / ResolvedCount / NewIssueCount: not derivable
            // from a payload-text group-by alone; return 0. To get
            // these per-OS / per-route, drill to dim=issue with the
            // corresponding filter.
            Measure::IssueCount | Measure::ResolvedCount | Measure::NewIssueCount => {
                Value::from(0)
            }
            // P50 / P95 duration require a spans join (TODO Phase 8).
            // For now, surface null so the UI can render "—".
            Measure::P50Duration | Measure::P95Duration => Value::Null,
            Measure::CrashFreeRate => Value::Null,
        };
        obj.insert(key, val);
    }
    Value::Object(obj)
}

#[derive(sqlx::FromRow)]
struct GroupedTextRow {
    dim_value: String,
    event_count: i64,
    unique_users: i64,
    first_seen: OffsetDateTime,
    last_seen: OffsetDateTime,
}

// ── v2.3 dim: issue_priority ──────────────────────────────────────────────
//
// Pulls directly from the `issues` table (not events) — priority is
// an issue-level attribute, not an event-level one. Reuses
// `releaseEq` / `statusIn` filters as on dim=issue. Window bounds
// apply to `issues.last_seen` so rows with no activity inside the
// window drop out.

#[allow(clippy::too_many_arguments)]
async fn explore_issue_priority(
    pool: &PgPool,
    project_id: Uuid,
    measures: &[Measure],
    filters: &ExploreFilters,
    received_at_gte: OffsetDateTime,
    received_at_lt: OffsetDateTime,
    order_by: Measure,
    order_dir: OrderDir,
    limit: i64,
) -> Result<(Vec<Value>, Value), AppError> {
    let release_eq = filters.release_eq.as_deref();
    let status_in = filters
        .status_in
        .as_ref()
        .map(|v| v.iter().map(|s| s.as_str()).collect::<Vec<_>>());

    let rows: Vec<PriorityAgg> = sqlx::query_as::<_, PriorityAgg>(
        r#"
        SELECT
          COALESCE(NULLIF(priority, ''), 'backlog')          AS priority,
          COUNT(*)::BIGINT                                   AS issue_count,
          COALESCE(SUM(event_count), 0)::BIGINT              AS event_count,
          MIN(first_seen)                                    AS first_seen,
          MAX(last_seen)                                     AS last_seen,
          COUNT(*) FILTER (WHERE first_seen >= $2)::BIGINT   AS new_issue_count
        FROM issues
        WHERE project_id = $1
          AND last_seen >= $2 AND last_seen < $3
          AND ($4::text   IS NULL OR last_release = $4::text)
          AND ($5::text[] IS NULL OR status = ANY($5::text[]))
        GROUP BY 1
        "#,
    )
    .bind(project_id)
    .bind(received_at_gte)
    .bind(received_at_lt)
    .bind(release_eq)
    .bind(status_in.as_deref())
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut rows = rows;
    rows.sort_by(|a, b| {
        let cmp = match order_by {
            Measure::EventCount => a.event_count.cmp(&b.event_count),
            Measure::IssueCount => a.issue_count.cmp(&b.issue_count),
            Measure::FirstSeen => a.first_seen.cmp(&b.first_seen),
            Measure::LastSeen => a.last_seen.cmp(&b.last_seen),
            Measure::NewIssueCount => a.new_issue_count.cmp(&b.new_issue_count),
            _ => a.issue_count.cmp(&b.issue_count),
        };
        match order_dir {
            OrderDir::Desc => cmp.reverse(),
            OrderDir::Asc => cmp,
        }
    });
    rows.truncate(limit as usize);

    let total_issues: i64 = rows.iter().map(|r| r.issue_count).sum();
    let total_events: i64 = rows.iter().map(|r| r.event_count).sum();
    let total_new: i64 = rows.iter().map(|r| r.new_issue_count).sum();
    let totals = serde_json::json!({
        "issue_count":     total_issues,
        "event_count":     total_events,
        "new_issue_count": total_new,
        "row_count":       rows.len(),
    });

    let out_rows = rows
        .into_iter()
        .map(|r| {
            let mut obj = serde_json::Map::new();
            obj.insert("issue_priority".into(), Value::String(r.priority.clone()));
            for m in measures {
                let key = serde_json::to_string(m)
                    .unwrap_or_default()
                    .trim_matches('"')
                    .to_string();
                let val = match m {
                    Measure::EventCount => Value::from(r.event_count),
                    Measure::IssueCount => Value::from(r.issue_count),
                    Measure::NewIssueCount => Value::from(r.new_issue_count),
                    Measure::FirstSeen => r
                        .first_seen
                        .format(&time::format_description::well_known::Rfc3339)
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                    Measure::LastSeen => r
                        .last_seen
                        .format(&time::format_description::well_known::Rfc3339)
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                    // unique_users / resolved_count not derivable from this
                    // priority-group agg alone; return 0.
                    Measure::UniqueUsers | Measure::ResolvedCount => Value::from(0),
                    Measure::P50Duration | Measure::P95Duration | Measure::CrashFreeRate => {
                        Value::Null
                    }
                };
                obj.insert(key, val);
            }
            Value::Object(obj)
        })
        .collect();

    Ok((out_rows, totals))
}

#[derive(sqlx::FromRow)]
struct PriorityAgg {
    priority: String,
    issue_count: i64,
    event_count: i64,
    first_seen: OffsetDateTime,
    last_seen: OffsetDateTime,
    new_issue_count: i64,
}

/// Round down to the start of the bucket. Postgres' `date_trunc`
/// uses UTC-anchored boundaries by default; mirror that so the
/// zero-fill loop generates the same instants.
fn truncate(t: OffsetDateTime, bucket: Bucket) -> OffsetDateTime {
    let utc = t.to_offset(time::UtcOffset::UTC);
    match bucket {
        Bucket::Hour => time::OffsetDateTime::from_unix_timestamp(
            utc.unix_timestamp() - (utc.unix_timestamp() % 3600),
        )
        .unwrap_or(t),
        Bucket::Day => {
            let mins = utc.hour() as i64 * 3600 + utc.minute() as i64 * 60 + utc.second() as i64;
            time::OffsetDateTime::from_unix_timestamp(utc.unix_timestamp() - mins).unwrap_or(t)
        }
        Bucket::Week => {
            // Truncate to Monday 00:00 UTC.
            let dow = utc.weekday().number_days_from_monday() as i64;
            let secs_since_start_of_day =
                utc.hour() as i64 * 3600 + utc.minute() as i64 * 60 + utc.second() as i64;
            let total = dow * 86400 + secs_since_start_of_day;
            time::OffsetDateTime::from_unix_timestamp(utc.unix_timestamp() - total).unwrap_or(t)
        }
    }
}

// ── unit tests ────────────────────────────────────────────────────────────
//
// v2.3 — verify the new filter / dim / measure variants serialize and
// deserialize correctly. Integration tests against real DB live in the
// regular `server/tests/` tree; these are JSON-shape only.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_all_new_filters() {
        let body = serde_json::json!({
            "dim": "time_bucket",
            "measures": ["event_count"],
            "filters": {
                "issueEq": "01900000-0000-7000-8000-000000000001",
                "userIdEq": "usr_42",
                "routeEq": "/checkout",
                "osEq": "ios",
                "search": "TypeError",
            },
        });
        let req: ExploreReq = serde_json::from_value(body).expect("parses");
        assert!(req.filters.issue_eq.is_some());
        assert_eq!(req.filters.user_id_eq.as_deref(), Some("usr_42"));
        assert_eq!(req.filters.route_eq.as_deref(), Some("/checkout"));
        assert_eq!(req.filters.os_eq.as_deref(), Some("ios"));
        assert_eq!(req.filters.search.as_deref(), Some("TypeError"));
    }

    #[test]
    fn deserializes_all_new_dims() {
        for dim_str in ["device_os", "issue_priority", "severity", "route"] {
            let body = serde_json::json!({
                "dim": dim_str,
                "measures": ["event_count"],
            });
            let req: ExploreReq =
                serde_json::from_value(body).unwrap_or_else(|e| panic!("{dim_str}: {e}"));
            // Round-trip via the dispatcher's name mapping is not
            // exercised here (needs a DB pool); we only assert the
            // Dim enum parsed.
            match (req.dim, dim_str) {
                (Dim::DeviceOs, "device_os")
                | (Dim::IssuePriority, "issue_priority")
                | (Dim::Severity, "severity")
                | (Dim::Route, "route") => {}
                (other, _) => panic!("wrong dim variant for {dim_str}: {other:?}"),
            }
        }
    }

    #[test]
    fn deserializes_all_new_measures() {
        let body = serde_json::json!({
            "dim": "release",
            "measures": [
                "event_count", "issue_count", "resolved_count", "unique_users",
                "first_seen", "last_seen",
                "new_issue_count", "p50_duration", "p95_duration", "crash_free_rate",
            ],
        });
        let req: ExploreReq = serde_json::from_value(body).expect("parses");
        assert_eq!(req.measures.len(), 10);
        assert!(req.measures.contains(&Measure::NewIssueCount));
        assert!(req.measures.contains(&Measure::P50Duration));
        assert!(req.measures.contains(&Measure::P95Duration));
        assert!(req.measures.contains(&Measure::CrashFreeRate));
    }

    #[test]
    fn rejects_unknown_dim() {
        let body = serde_json::json!({"dim": "not_a_dim", "measures": ["event_count"]});
        let r: Result<ExploreReq, _> = serde_json::from_value(body);
        assert!(r.is_err());
    }

    #[test]
    fn rejects_unknown_measure() {
        let body = serde_json::json!({
            "dim": "release",
            "measures": ["not_a_measure"],
        });
        let r: Result<ExploreReq, _> = serde_json::from_value(body);
        assert!(r.is_err());
    }
}
