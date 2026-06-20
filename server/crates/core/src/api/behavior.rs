// v1.1 chunk D — Behavior + User detail read APIs.
//
// `GET /admin/api/projects/{id}/audience/top-routes?since=…&limit=N`
//   Aggregates $pageview track events by `route`, returning view
//   count + distinct user count per route. Drives the Behavior >
//   Top routes table.
//
// `GET /admin/api/projects/{id}/users/{user_id}/timeline?since=…`
//   Returns up to 200 chronological events for the user across
//   track_events + the error events table (joined by user_id). The
//   dashboard renders this as the User detail timeline that the
//   Audience country breakdown click-through opens.
//
// Both queries are best-effort: when `db` isn't configured they
// return empty payloads instead of 5xx-ing the panel.

use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopRoutesParams {
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub since: Option<OffsetDateTime>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopRouteRow {
    pub route: String,
    pub views: i64,
    pub unique_users: i64,
}

pub async fn top_routes(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
    Query(params): Query<TopRoutesParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<TopRouteRow>::new()).into_response());
    };
    let now = OffsetDateTime::now_utc();
    let since = params.since.unwrap_or(now - time::Duration::days(7));
    let limit = params.limit.unwrap_or(50).clamp(1, 500);

    let rows: Vec<(String, i64, i64)> = sqlx::query_as(
        "SELECT route, COUNT(*)::bigint AS views, \
                COUNT(DISTINCT user_id)::bigint AS unique_users \
         FROM track_events \
         WHERE project_id = $1 AND name = '$pageview' \
               AND route IS NOT NULL \
               AND occurred_at >= $2 \
         GROUP BY route \
         ORDER BY views DESC \
         LIMIT $3",
    )
    .bind(project_id)
    .bind(since)
    .bind(limit)
    .fetch_all(pool as &PgPool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let out: Vec<TopRouteRow> = rows
        .into_iter()
        .map(|(route, views, unique_users)| TopRouteRow {
            route,
            views,
            unique_users,
        })
        .collect();
    Ok(Json(out).into_response())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserTimelineParams {
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub since: Option<OffsetDateTime>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "source")]
pub enum TimelineEntry {
    #[serde(rename = "track", rename_all = "camelCase")]
    Track {
        #[serde(with = "time::serde::rfc3339")]
        t: OffsetDateTime,
        name: String,
        route: Option<String>,
        props: serde_json::Value,
    },
    #[serde(rename = "error", rename_all = "camelCase")]
    Error {
        #[serde(with = "time::serde::rfc3339")]
        t: OffsetDateTime,
        event_id: Uuid,
        error_type: String,
        message: String,
        environment: Option<String>,
    },
}

fn entry_time(e: &TimelineEntry) -> OffsetDateTime {
    match e {
        TimelineEntry::Track { t, .. } => *t,
        TimelineEntry::Error { t, .. } => *t,
    }
}

pub async fn user_timeline(
    State(state): State<AppState>,
    Path((project_id, user_id)): Path<(Uuid, String)>,
    Query(params): Query<UserTimelineParams>,
) -> Result<Response, AppError> {
    let Some(pool) = &state.db else {
        return Ok(Json(Vec::<TimelineEntry>::new()).into_response());
    };
    let now = OffsetDateTime::now_utc();
    let since = params.since.unwrap_or(now - time::Duration::hours(24));
    let limit = params.limit.unwrap_or(200).clamp(1, 1000);

    // Pull both streams in parallel.
    let (tracks, errors) = tokio::try_join!(
        fetch_user_tracks(pool, project_id, &user_id, since, limit),
        fetch_user_errors(pool, project_id, &user_id, since, limit),
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut combined: Vec<TimelineEntry> =
        Vec::with_capacity(tracks.len() + errors.len());
    combined.extend(tracks);
    combined.extend(errors);
    combined.sort_by(|a, b| entry_time(b).cmp(&entry_time(a)));
    combined.truncate(limit as usize);

    Ok(Json(combined).into_response())
}

async fn fetch_user_tracks(
    pool: &PgPool,
    project_id: Uuid,
    user_id: &str,
    since: OffsetDateTime,
    limit: i64,
) -> Result<Vec<TimelineEntry>, sqlx::Error> {
    let rows: Vec<(OffsetDateTime, String, Option<String>, serde_json::Value)> = sqlx::query_as(
        "SELECT occurred_at, name, route, props FROM track_events \
         WHERE project_id = $1 AND user_id = $2 AND occurred_at >= $3 \
         ORDER BY occurred_at DESC \
         LIMIT $4",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(t, name, route, props)| TimelineEntry::Track {
            t,
            name,
            route,
            props,
        })
        .collect())
}

async fn fetch_user_errors(
    pool: &PgPool,
    project_id: Uuid,
    user_id: &str,
    since: OffsetDateTime,
    limit: i64,
) -> Result<Vec<TimelineEntry>, sqlx::Error> {
    let rows: Vec<(Uuid, OffsetDateTime, String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, occurred_at, error_type, error_message, environment \
         FROM events \
         WHERE project_id = $1 \
               AND payload->'user'->>'id' = $2 \
               AND occurred_at >= $3 \
         ORDER BY occurred_at DESC \
         LIMIT $4",
    )
    .bind(project_id)
    .bind(user_id)
    .bind(since)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(event_id, t, error_type, message, environment)| TimelineEntry::Error {
            t,
            event_id,
            error_type,
            message,
            environment,
        })
        .collect())
}
