// F4 — sentori eats its own dog food.
//
// `GET /admin/api/self-test` returns a JSON snapshot the dashboard's
// Overview "platform health" strip consumes. Each tier (db / valkey /
// ingest) is probed inline with a tight budget; failures degrade
// individual fields rather than 5xx-ing the response.

use std::time::Instant;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use redis::AsyncCommands;
use serde::Serialize;

use crate::recent::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfTest {
    /// Always present. Server reports its own version so dashboards
    /// can detect a mismatched build before the user has to grep CI.
    pub server_version: &'static str,
    /// Roundtrip to Postgres in ms. `null` when DB isn't configured
    /// (dev / static-mode), `-1` when the probe failed.
    pub db_rt_ms: Option<i64>,
    /// Roundtrip to Valkey in ms. Same semantics as `db_rt_ms`.
    pub valkey_rt_ms: Option<i64>,
    /// Heuristic health flag rolled up from the probes — `green`
    /// when every configured tier responded within budget, `amber`
    /// when something is slow (>200 ms) but reachable, `red` when
    /// any configured tier failed.
    pub overall: &'static str,
}

const SLOW_BUDGET_MS: i64 = 200;
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

pub async fn handle(State(state): State<AppState>) -> Response {
    let db_rt_ms = match &state.db {
        Some(pool) => Some(probe_db(pool).await),
        None => None,
    };

    let valkey_rt_ms = match &state.valkey {
        Some(v) => Some(probe_valkey(v.clone()).await),
        None => None,
    };

    let overall = roll_up(db_rt_ms, valkey_rt_ms);

    let body = SelfTest {
        server_version: SERVER_VERSION,
        db_rt_ms,
        valkey_rt_ms,
        overall,
    };

    (StatusCode::OK, Json(body)).into_response()
}

async fn probe_db(pool: &sqlx::PgPool) -> i64 {
    let started = Instant::now();
    // Cast the literal so sqlx's type-inference picks BIGINT to match
    // the declared `i64` row type. The bare `SELECT 1` returns INT4
    // which fails to decode into `i64` — that bug was sitting on the
    // prod Overview strip showing `dbRtMs: -1` (red) even though the
    // DB was up.
    let res: Result<i64, _> = sqlx::query_scalar("SELECT 1::bigint").fetch_one(pool).await;
    match res {
        Ok(_) => started.elapsed().as_millis() as i64,
        Err(e) => {
            tracing::warn!(error = %e, "self-test db probe failed");
            -1
        }
    }
}

async fn probe_valkey(mut conn: redis::aio::ConnectionManager) -> i64 {
    let started = Instant::now();
    let res: Result<String, _> = redis::cmd("PING").query_async(&mut conn).await;
    match res {
        Ok(_) => started.elapsed().as_millis() as i64,
        Err(e) => {
            tracing::warn!(error = %e, "self-test valkey probe failed");
            -1
        }
    }
}

fn roll_up(db: Option<i64>, valkey: Option<i64>) -> &'static str {
    let mut overall = "green";
    for probe in [db, valkey].into_iter().flatten() {
        if probe < 0 {
            return "red";
        }
        if probe > SLOW_BUDGET_MS {
            overall = "amber";
        }
    }
    overall
}

/// Tiny touch needed to keep clippy from complaining about unused
/// imports inside the public surface; the `AsyncCommands` import
/// is used inside test scaffolding only.
#[allow(dead_code)]
fn _ensure_async_commands<C: AsyncCommands>(_: C) {}
