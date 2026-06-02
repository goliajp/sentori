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
//! Additional dims (`issue.priority`, `device.os`, `time_bucket`...) and
//! measures (`new_issue_count`, `crash_free_rate`...) extend in
//! `v2.3+` by adding match arms here. The shape stays stable.

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
          AND ($4::text IS NULL OR environment = $4::text)
          AND ($5::text[] IS NULL OR (payload->>'kind') = ANY($5::text[]))
        GROUP BY release
        "#,
    )
    .bind(project_id)
    .bind(received_at_gte)
    .bind(received_at_lt)
    .bind(env_filter)
    .bind(kinds_filter.as_deref())
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
          AND ($2::text IS NULL OR last_release = $2::text)
          AND ($3::text[] IS NULL OR status = ANY($3::text[]))
        "#,
    )
    .bind(project_id)
    .bind(release_eq)
    .bind(status_in.as_deref())
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
          AND ($4::text IS NULL OR environment = $4::text)
          AND ($5::text IS NULL OR release = $5::text)
          AND ($6::text[] IS NULL OR (payload->>'kind') = ANY($6::text[]))
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
                    | Measure::LastSeen => Value::from(0),
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
