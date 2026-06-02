// Analytics v1 — Live concurrent-user snapshot for the dashboard.
//
// `GET /admin/api/projects/{project_id}/live` reads the per-project
// Valkey ZSET + parallel dims hash and returns the headline
// concurrent count plus four top-5 breakdowns (release / os /
// country / route). Client polls every 5 s; server-side is O(active
// members) on Valkey, negligible CPU.

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use crate::live_presence::{self, WINDOW_MS};
use crate::recent::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshot {
    /// Distinct users (or anon sessions) heartbeat-ed within the
    /// presence window.
    pub concurrent: usize,
    pub window_seconds: i64,
    pub by_release: Vec<BreakdownRow>,
    pub by_os: Vec<BreakdownRow>,
    pub by_route: Vec<BreakdownRow>,
    pub by_country: Vec<BreakdownRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakdownRow {
    pub label: String,
    pub count: usize,
}

pub async fn handle(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Response {
    let mut valkey = match &state.valkey {
        Some(v) => v.clone(),
        None => {
            // Fail-open: no Valkey configured → render the dashboard
            // as if no users are present. Beats 5xx-ing the panel.
            return ok(empty_snapshot());
        }
    };

    let now_ms = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)) as i64;

    let members = match live_presence::snapshot(&mut valkey, &project_id, WINDOW_MS, now_ms).await {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, %project_id, "live snapshot read failed; failing open");
            return ok(empty_snapshot());
        }
    };

    let concurrent = members.len();
    if concurrent == 0 {
        return ok(empty_snapshot());
    }

    let dims = match live_presence::fetch_dims(&mut valkey, &project_id, &members).await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(error = %e, %project_id, "live dims read failed; returning count only");
            return ok(LiveSnapshot {
                concurrent,
                window_seconds: WINDOW_MS / 1000,
                ..empty_snapshot()
            });
        }
    };

    let mut by_release: HashMap<String, usize> = HashMap::new();
    let mut by_os: HashMap<String, usize> = HashMap::new();
    let mut by_route: HashMap<String, usize> = HashMap::new();
    let mut by_country: HashMap<String, usize> = HashMap::new();
    for d in dims.into_iter().flatten() {
        if !d.release.is_empty() {
            *by_release.entry(d.release).or_insert(0) += 1;
        }
        if let Some(os) = d.os {
            *by_os.entry(os).or_insert(0) += 1;
        }
        if let Some(r) = d.route {
            *by_route.entry(r).or_insert(0) += 1;
        }
        if let Some(c) = d.country {
            *by_country.entry(c).or_insert(0) += 1;
        }
    }

    ok(LiveSnapshot {
        concurrent,
        window_seconds: WINDOW_MS / 1000,
        by_release: top_k(by_release, 5),
        by_os: top_k(by_os, 5),
        by_route: top_k(by_route, 5),
        by_country: top_k(by_country, 5),
    })
}

fn top_k(map: HashMap<String, usize>, k: usize) -> Vec<BreakdownRow> {
    let mut rows: Vec<BreakdownRow> = map
        .into_iter()
        .map(|(label, count)| BreakdownRow { label, count })
        .collect();
    // Highest count first; deterministic tie-break on label.
    rows.sort_by(|a, b| b.count.cmp(&a.count).then(a.label.cmp(&b.label)));
    rows.truncate(k);
    rows
}

fn empty_snapshot() -> LiveSnapshot {
    LiveSnapshot {
        concurrent: 0,
        window_seconds: WINDOW_MS / 1000,
        by_release: vec![],
        by_os: vec![],
        by_route: vec![],
        by_country: vec![],
    }
}

fn ok(snap: LiveSnapshot) -> Response {
    (StatusCode::OK, Json(snap)).into_response()
}
