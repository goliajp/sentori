//! POST /admin/api/projects/:project_id/push/audience/preview
//!
//! How many devices an audience selects, and a few of them.
//!
//! Without this the only way to find out what an expression matches is
//! to send to it, which is not a thing anyone can undo. A condition
//! editor that cannot answer "how many?" is a text box that fires
//! notifications at strangers.
//!
//! The count comes from the same compiler the send uses, so a preview
//! that says 412 is not an estimate of what a send would do — it is
//! the same query with `count(*)` in front of it.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tracing::warn;
use uuid::Uuid;

use crate::session_mw::SessionContext;
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewBody {
    #[serde(default)]
    pub app_user_id: Option<String>,
    #[serde(default)]
    pub traits: Option<Value>,
    #[serde(default)]
    pub audience: Option<Value>,
}

/// How many of the matched devices to show.
///
/// Enough to tell "this is the group I meant" from "this is every
/// device I have", which is the question a sample answers. More than
/// that is a device list, and there is already one of those.
const SAMPLE: i64 = 8;

pub async fn preview(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<PreviewBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    super::tokens::ensure_project_access(&state, &ctx, project_id).await?;

    let audience = crate::audience::from_request(
        body.app_user_id.as_deref(),
        body.traits.as_ref(),
        body.audience.as_ref(),
    )
    .map_err(|detail| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "bad_audience", "detail": detail })),
        )
    })?;

    let Some(audience) = audience else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "bad_audience",
                "detail": "give appUserId, traits or audience",
            })),
        ));
    };

    // `$1` is the project; the audience numbers from `$2`.
    let (frag, binds) = audience.to_sql(2);
    let where_clause = format!("dt.project_id = $1 AND dt.revoked_at IS NULL AND ({frag})");

    let count_sql = format!("SELECT count(*) AS n FROM device_tokens dt WHERE {where_clause}");
    let mut q = sqlx::query(&count_sql).bind(project_id);
    for b in &binds {
        q = b.attach(q);
    }
    let matched = q
        .fetch_one(&state.pool)
        .await
        .map(|r| r.get::<i64, _>("n"))
        .map_err(|e| {
            // The compiler produces valid SQL for anything it accepted, so
            // a failure here is ours rather than the caller's — and saying
            // "no devices" would read as an answer.
            warn!(error = %e, "push.audience preview_failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        })?;

    // The token itself never comes back — the device list is careful
    // about that and a preview must not be the way around it.
    let sample_sql = format!(
        "SELECT dt.id, dt.provider, dt.traits, dt.metadata, \
                dt.user_key IS NOT NULL AS addressable, \
                right(dt.user_key, 6) AS user_key_tail \
         FROM device_tokens dt WHERE {where_clause} \
         ORDER BY dt.last_seen_at DESC LIMIT {SAMPLE}"
    );
    let mut q = sqlx::query(&sample_sql).bind(project_id);
    for b in &binds {
        q = b.attach(q);
    }
    let rows = q.fetch_all(&state.pool).await.unwrap_or_default();

    let sample: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.get::<Uuid, _>("id").to_string(),
                "provider": r.get::<String, _>("provider"),
                "traits": r.get::<Value, _>("traits"),
                "metadata": r.get::<Value, _>("metadata"),
                "addressable": r.get::<bool, _>("addressable"),
                "userKeyTail": r.get::<Option<String>, _>("user_key_tail"),
            })
        })
        .collect();

    Ok(Json(json!({ "matched": matched, "sample": sample })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendBody {
    #[serde(default)]
    pub app_user_id: Option<String>,
    #[serde(default)]
    pub traits: Option<Value>,
    #[serde(default)]
    pub audience: Option<Value>,
    pub title: String,
    #[serde(default)]
    pub body: String,
    /// What the preview said, from the operator who is looking at it.
    ///
    /// Required, and the send is refused if it no longer holds. An
    /// audience is live data: devices register between reading a
    /// number and pressing a button, and "it said 12" is the only
    /// thing standing between a careful operator and a notification
    /// to everyone. Nothing here can be undone, so the console is not
    /// allowed to send to a number nobody read.
    pub expected_matched: i64,
}

/// Queue a send to everyone an audience selects.
pub async fn send(
    State(state): State<Arc<AppState>>,
    Extension(ctx): Extension<SessionContext>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<SendBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    super::tokens::ensure_project_access(&state, &ctx, project_id).await?;

    let bad = |detail: String| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "bad_audience", "detail": detail })),
        )
    };

    if body.title.trim().is_empty() {
        return Err(bad("a notification with no title shows nothing".to_string()));
    }

    let audience = crate::audience::from_request(
        body.app_user_id.as_deref(),
        body.traits.as_ref(),
        body.audience.as_ref(),
    )
    .map_err(bad)?
    .ok_or_else(|| bad("give appUserId, traits or audience".to_string()))?;

    let (frag, binds) = audience.to_sql(2);
    let where_clause = format!("dt.project_id = $1 AND dt.revoked_at IS NULL AND ({frag})");

    // Counted first, and compared with what the operator read. Doing
    // it in the same transaction as the insert would be tighter, and
    // it is not what this guards against: the gap that matters is the
    // one between a human reading a number and clicking, not the
    // milliseconds inside the request.
    let count_sql = format!("SELECT count(*) AS n FROM device_tokens dt WHERE {where_clause}");
    let mut q = sqlx::query(&count_sql).bind(project_id);
    for b in &binds {
        q = b.attach(q);
    }
    let matched = q
        .fetch_one(&state.pool)
        .await
        .map(|r| r.get::<i64, _>("n"))
        .map_err(|e| {
            warn!(error = %e, "push.audience send_count_failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "internal" })),
            )
        })?;

    if matched != body.expected_matched {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "audience_changed",
                "matched": matched,
                "expected": body.expected_matched,
                "detail": "this audience does not select what it did when you \
                           previewed it — look again before sending",
            })),
        ));
    }

    let insert_sql = format!(
        "INSERT INTO push_sends (id, project_id, token_id, provider, payload, status) \
         SELECT gen_random_uuid(), $1, dt.id, dt.provider, $2, 'queued' \
         FROM device_tokens dt WHERE {where_clause} \
         RETURNING id"
    );
    // `$1` project, `$2` payload, then the audience — which numbered
    // itself from 2, so its own binds shift by one here.
    let insert_sql = shift_placeholders(&insert_sql);
    let mut q = sqlx::query(&insert_sql)
        .bind(project_id)
        .bind(json!({ "title": body.title, "body": body.body }));
    for b in &binds {
        q = b.attach(q);
    }
    let rows = q.fetch_all(&state.pool).await.map_err(|e| {
        warn!(error = %e, "push.audience send_failed");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal" })),
        )
    })?;

    Ok(Json(json!({ "queued": rows.len() })))
}

/// Move every placeholder above `$1` up by one.
///
/// The audience compiler is told where to start, and here it is asked
/// twice with different offsets — once for the count, once for the
/// insert, which has a payload in between. Rather than compile it
/// twice and risk the two disagreeing about what they select, the one
/// fragment is renumbered.
fn shift_placeholders(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len() + 8);
    let mut rest = sql;
    while let Some(i) = rest.find('$') {
        out.push_str(&rest[..i]);
        let digits: String = rest[i + 1..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        match digits.parse::<usize>() {
            Ok(n) if n > 1 => {
                out.push('$');
                out.push_str(&(n + 1).to_string());
            }
            _ => {
                out.push('$');
                out.push_str(&digits);
            }
        }
        rest = &rest[i + 1 + digits.len()..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The renumbering leaves `$1` alone and moves the rest up one, so
    /// the payload can sit at `$2` without the audience being compiled
    /// a second time.
    #[test]
    fn renumbering_makes_room_for_the_payload() {
        assert_eq!(
            shift_placeholders("WHERE dt.project_id = $1 AND (a = $2 OR b = $10)"),
            "WHERE dt.project_id = $1 AND (a = $3 OR b = $11)"
        );
    }

    /// A statement with nothing to move comes back unchanged, rather
    /// than losing its last character to an off-by-one in the walk.
    #[test]
    fn a_statement_with_no_placeholders_survives() {
        assert_eq!(shift_placeholders("SELECT 1 FROM t"), "SELECT 1 FROM t");
        assert_eq!(shift_placeholders("x = $1"), "x = $1");
    }
}
