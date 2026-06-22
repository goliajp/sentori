//! Saasadmin role middleware — further restricts /admin/api/saas/*
//! to a configured set of user_ids.
//!
//! In SaaS deployments, only a small number of operator accounts
//! should see the cross-workspace view. Regular workspace users
//! who happen to be logged in shouldn't be able to enumerate
//! other tenants.
//!
//! v0.2 step: env-var driven (`SENTORI_SAASADMIN_USER_IDS` — comma-
//! separated UUIDs). A future commit could promote this to a
//! `saasadmin_users` table.

use axum::{
    body::Body,
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde_json::json;
use uuid::Uuid;

use crate::session_mw::SessionContext;

pub async fn saasadmin_only(req: Request<Body>, next: Next) -> Response {
    let Some(ctx) = req.extensions().get::<SessionContext>().copied() else {
        return reject("session context missing — session middleware must run first");
    };
    if !is_saasadmin(ctx.user_id.into_uuid()) {
        return reject("saasadmin role required");
    }
    next.run(req).await
}

fn is_saasadmin(user_id: Uuid) -> bool {
    let Ok(raw) = std::env::var("SENTORI_SAASADMIN_USER_IDS") else {
        // No allowlist configured. Default open in self-hosted
        // (single user is owner = de-facto saasadmin); locking
        // is operator's responsibility in SaaS mode.
        return true;
    };
    raw.split(',')
        .filter_map(|s| Uuid::parse_str(s.trim()).ok())
        .any(|u| u == user_id)
}

fn reject(reason: &str) -> Response {
    let body = json!({ "error": "forbidden", "reason": reason });
    (StatusCode::FORBIDDEN, axum::Json(body)).into_response()
}
