// v2.7 — push HTTP handlers.
//
// All routes sit on the ingestion router (`ingest.sentori.golia.jp/v1/push/*`)
// behind the same `require_token` + `rate_limit_middleware` chain as
// `/v1/events`. Auth shape is project-scoped Bearer; both the public
// (mobile/browser) endpoints and the backend-integrator endpoints
// use the same auth chain — distinction is by token kind on the
// caller side, not by URL or middleware.
//
// Routes:
//   POST   /v1/push/tokens                    — register / refresh
//   DELETE /v1/push/tokens/:ipt_handle        — revoke
//   POST   /v1/push/send                      — Sentori-native send
//   GET    /v1/push/receipts/:send_id         — Sentori-native receipt
//   POST   /v1/push/expo-compat/send          — Expo-shape send
//   GET    /v1/push/expo-compat/receipts/:id  — Expo-shape receipt

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::api::events::caller_project_id;
use crate::auth::IngestCaller;
use crate::push::{
    delivery,
    expo_compat::{self, ExpoRequest, ExpoResponseEnvelope},
    send,
    tokens::{self, RegisterTokenInput},
    types::{parse_send_id, parse_token_handle, NativeMessage, Ticket, ToField},
};
use crate::recent::AppState;

// ── tokens ─────────────────────────────────────────────────────────────

pub async fn register_token(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(input): Json<RegisterTokenInput>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let project_id = caller_project_id(&caller, &state);
    match tokens::register_token(pool, project_id, input, None).await {
        Ok(reg) => (StatusCode::OK, Json(reg)).into_response(),
        Err(tokens::TokenError::InvalidProvider(p)) => bad_request(format!(
            "invalid provider '{p}'; expected one of apns/fcm/webpush/hcm/mipush"
        )),
        Err(tokens::TokenError::EmptyNativeToken) => {
            bad_request("native_token must not be empty".into())
        }
        Err(tokens::TokenError::Database(e)) => {
            tracing::warn!(error = %e, "push token register failed");
            internal_error()
        }
    }
}

pub async fn revoke_token(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Path(handle): Path<String>,
) -> Response {
    let Some(token_uuid) = parse_token_handle(&handle) else {
        return bad_request(format!("invalid token handle '{handle}'"));
    };
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let project_id = caller_project_id(&caller, &state);
    match tokens::revoke_token(pool, project_id, token_uuid).await {
        // 204 is idempotent: returning ok even when no row matches
        // keeps clients from leaking that a token never existed.
        Ok(_found) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "push token revoke failed");
            internal_error()
        }
    }
}

// ── send / receipt — Sentori native ────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SendResponse {
    tickets: Vec<Ticket>,
}

pub async fn send_native(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(msg): Json<NativeMessage>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let project_id = caller_project_id(&caller, &state);
    match send::enqueue_send(pool, project_id, &msg).await {
        Ok(tickets) => (StatusCode::OK, Json(SendResponse { tickets })).into_response(),
        Err(send::SendError::TokenNotFound(t)) => {
            bad_request(format!("device token '{t}' not registered or revoked"))
        }
        Err(send::SendError::InvalidTokenHandle(h)) => {
            bad_request(format!("invalid token handle '{h}'"))
        }
        Err(send::SendError::Database(e)) => {
            tracing::warn!(error = %e, "push send enqueue failed");
            internal_error()
        }
    }
}

pub async fn get_receipt(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Path(handle): Path<String>,
) -> Response {
    let Some(send_uuid) = parse_send_id(&handle) else {
        return bad_request(format!("invalid send id '{handle}'"));
    };
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let project_id = caller_project_id(&caller, &state);
    match delivery::get_receipt(pool, project_id, send_uuid).await {
        Ok(Some(ticket)) => (StatusCode::OK, Json(json!({ "ticket": ticket }))).into_response(),
        Ok(None) => not_found(format!("send '{handle}' not found")),
        Err(e) => {
            tracing::warn!(error = %e, "push receipt fetch failed");
            internal_error()
        }
    }
}

// ── send / receipt — Expo-compatible ───────────────────────────────────

pub async fn send_expo_compat(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Json(req): Json<ExpoRequest>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let project_id = caller_project_id(&caller, &state);
    let expo_msgs = match req {
        ExpoRequest::Single(m) => vec![m],
        ExpoRequest::Batch(v) => v,
    };
    let mut response_tickets = Vec::with_capacity(expo_msgs.len());
    for expo_msg in expo_msgs {
        // Each Expo message can carry an array `to` (Expo batches
        // up-to-N tokens per call). We translate, enqueue, and emit
        // one ExpoTicket per recipient.
        let native = expo_compat::to_native(expo_msg);
        let recipients = native.to.as_vec();
        for recipient in recipients {
            // Reshape the multi-recipient native message into a
            // single-recipient one so enqueue_send returns exactly
            // one ticket per Expo loop iteration. This keeps the
            // Expo response indexable by input position.
            let mut single = native.clone();
            single.to = ToField::Single(recipient.clone());
            match send::enqueue_send(pool, project_id, &single).await {
                Ok(mut tickets) if !tickets.is_empty() => {
                    response_tickets.push(expo_compat::to_expo_ticket(tickets.remove(0)));
                }
                Ok(_) => {
                    response_tickets.push(expo_compat::ExpoTicket::Error {
                        id: None,
                        message: "no ticket returned".into(),
                        details: None,
                    });
                }
                Err(send::SendError::TokenNotFound(_)) => {
                    response_tickets.push(expo_compat::ExpoTicket::Error {
                        id: None,
                        message: "DeviceNotRegistered".into(),
                        details: Some(expo_compat::ExpoTicketErrorDetails {
                            error: "DeviceNotRegistered".into(),
                        }),
                    });
                }
                Err(send::SendError::InvalidTokenHandle(h)) => {
                    response_tickets.push(expo_compat::ExpoTicket::Error {
                        id: None,
                        message: format!("invalid token handle '{h}'"),
                        details: None,
                    });
                }
                Err(send::SendError::Database(e)) => {
                    tracing::warn!(error = %e, "expo-compat send failed");
                    response_tickets.push(expo_compat::ExpoTicket::Error {
                        id: None,
                        message: "internal error".into(),
                        details: None,
                    });
                }
            }
        }
    }
    (
        StatusCode::OK,
        Json(ExpoResponseEnvelope { data: response_tickets }),
    )
        .into_response()
}

pub async fn get_receipt_expo_compat(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Path(handle): Path<String>,
) -> Response {
    let Some(send_uuid) = parse_send_id(&handle) else {
        return bad_request(format!("invalid send id '{handle}'"));
    };
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let project_id = caller_project_id(&caller, &state);
    match delivery::get_receipt(pool, project_id, send_uuid).await {
        Ok(Some(ticket)) => {
            let expo = expo_compat::to_expo_ticket(ticket);
            (
                StatusCode::OK,
                Json(ExpoResponseEnvelope { data: vec![expo] }),
            )
                .into_response()
        }
        Ok(None) => not_found(format!("send '{handle}' not found")),
        Err(e) => {
            tracing::warn!(error = %e, "expo-compat receipt fetch failed");
            internal_error()
        }
    }
}

// ── helpers ────────────────────────────────────────────────────────────

fn bad_request(msg: String) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
}

fn not_found(msg: String) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": msg }))).into_response()
}

fn internal_error() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "internal error" })),
    )
        .into_response()
}

fn db_not_configured() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "error": "dbNotConfigured" })),
    )
        .into_response()
}

// ── input deserialisation helpers ──────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PushIngestQuery {
    pub project_id: Option<String>,
}
