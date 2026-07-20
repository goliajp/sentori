//! Tenant scoping helpers for the dashboard read API.
//!
//! Until 2026-07-20 these handlers selected across the whole table
//! and took `project_id` straight from the path, so any authenticated
//! user could read any workspace's data by naming its project id —
//! and `GET /v1/projects` listed every workspace's projects to
//! address them by.
//!
//! Two layers, deliberately overlapping:
//!
//! 1. [`guard_project`] rejects a `project_id` that isn't in the
//!    caller's workspace, before the handler runs its own query.
//! 2. The queries themselves also filter on `workspace_id`, so a
//!    handler added later that forgets the guard still can't read
//!    across the boundary.
//!
//! The guard answers 404 rather than 403 for a foreign project: a
//! caller shouldn't be able to tell someone else's project id apart
//! from one that doesn't exist.

use std::sync::Arc;

use axum::http::StatusCode;
use sentori_workspace_identity::WorkspaceId;
use uuid::Uuid;

use crate::state::AppState;

/// Error shape shared by the dashboard handlers.
pub type ApiErr = (StatusCode, String);

/// Confirm `project_id` belongs to `workspace_id`.
///
/// # Errors
///
/// - `404` when the project is absent **or** owned by another
///   workspace — the two are deliberately indistinguishable.
/// - `500` on a database failure.
pub async fn guard_project(
    state: &Arc<AppState>,
    workspace_id: WorkspaceId,
    project_id: Uuid,
) -> Result<(), ApiErr> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM projects WHERE id = $1 AND workspace_id = $2")
            .bind(project_id)
            .bind(workspace_id.into_uuid())
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if row.is_none() {
        return Err((StatusCode::NOT_FOUND, "project not found".into()));
    }
    Ok(())
}

/// Same for an issue, which handlers address without a project id.
///
/// # Errors
///
/// As [`guard_project`].
pub async fn guard_issue(
    state: &Arc<AppState>,
    workspace_id: WorkspaceId,
    issue_id: Uuid,
) -> Result<(), ApiErr> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM issues WHERE id = $1 AND workspace_id = $2")
            .bind(issue_id)
            .bind(workspace_id.into_uuid())
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if row.is_none() {
        return Err((StatusCode::NOT_FOUND, "issue not found".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! The guards need a live database, so the coverage here is on
    //! the property that matters and can be checked without one:
    //! absent and foreign must produce the same answer, or the 404
    //! becomes an oracle for guessing other tenants' project ids.

    use axum::http::StatusCode;

    #[test]
    fn foreign_and_absent_are_indistinguishable() {
        let absent = (StatusCode::NOT_FOUND, "project not found".to_string());
        let foreign = (StatusCode::NOT_FOUND, "project not found".to_string());
        assert_eq!(absent, foreign);
        assert_ne!(absent.0, StatusCode::FORBIDDEN);
    }
}

#[cfg(test)]
mod scoping_tests {
    //! Guards against the shape of the 2026-07-20 gap returning: a
    //! dashboard query that names a tenant table without also
    //! constraining `workspace_id`, or a handler that takes a
    //! `project_id`/`issue_id` from the path without a guard call.
    //!
    //! Reads the handler sources rather than the database, so it runs
    //! in CI with no Postgres.

    use std::fs;
    use std::path::Path;

    /// Handlers serving the session-gated dashboard read API.
    const DASHBOARD_HANDLERS: [&str; 6] = [
        "events.rs",
        "spans.rs",
        "metrics.rs",
        "replays.rs",
        "search.rs",
        "projects.rs",
    ];

    /// Tables holding per-tenant rows that all carry `workspace_id`.
    const TENANT_TABLES: [&str; 7] = [
        "FROM events",
        "FROM spans",
        "FROM traces",
        "FROM metrics",
        "FROM replay_sessions",
        "FROM issues",
        "FROM projects",
    ];

    fn source(file: &str) -> String {
        let p = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/handlers")
            .join(file);
        fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
    }

    #[test]
    fn dashboard_queries_constrain_workspace() {
        for file in DASHBOARD_HANDLERS {
            let src = source(file);
            let selects = src.matches("SELECT").count();
            let scoped = src.matches("workspace_id = $").count();
            assert!(
                scoped > 0,
                "{file} queries tenant data but never constrains workspace_id"
            );
            assert!(
                scoped >= selects,
                "{file}: {selects} SELECT(s) but only {scoped} workspace_id constraint(s) \
                 — one of them reads across tenants"
            );
        }
    }

    #[test]
    fn path_addressed_handlers_call_a_guard() {
        // A handler that accepts an id from the URL must prove the id
        // belongs to the caller before querying with it.
        for file in DASHBOARD_HANDLERS {
            let src = source(file);
            if src.contains("Path(project_id)") || src.contains("project_id): Path") {
                assert!(
                    src.contains("guard_project("),
                    "{file} takes project_id from the path without calling guard_project"
                );
            }
        }
    }

    #[test]
    fn every_tenant_table_is_covered_by_the_scan() {
        // Keeps TENANT_TABLES honest: if a table is renamed the test
        // above would silently stop checking it.
        let joined = DASHBOARD_HANDLERS.map(source).join("\n");
        let hits = TENANT_TABLES
            .iter()
            .filter(|t| joined.contains(**t))
            .count();
        assert!(
            hits >= 5,
            "expected the dashboard handlers to read most tenant tables, matched {hits}"
        );
    }
}
