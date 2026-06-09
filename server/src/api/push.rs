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
    send_gate::GateError,
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

    // v2.20 send-API gate — input-side guards before enqueue.
    let recipients = msg.to.as_vec();
    if let Err(err) = crate::push::send_gate::check_batch_size(recipients.len()) {
        return gate_error_response(err);
    }
    let payload_bytes = serde_json::to_vec(&msg).map(|v| v.len()).unwrap_or(0);
    if let Err(err) = crate::push::send_gate::check_payload_size(payload_bytes) {
        return gate_error_response(err);
    }
    for recipient in &recipients {
        if let Err(err) = state.send_gate.check_and_record_token(recipient).await {
            return gate_error_response(err);
        }
    }

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

/// Translate a v2.20 [`GateError`] into the customer-facing HTTP
/// response shape. PayloadTooBig + BatchTooLarge are 400; rate-limit
/// is 429 with `Retry-After`.
fn gate_error_response(err: GateError) -> Response {
    match err {
        GateError::PayloadTooBig { actual, max } => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": {
                    "code": "PayloadTooBig",
                    "message": format!("payload {actual} bytes exceeds {max} byte cap"),
                    "actualBytes": actual,
                    "maxBytes": max,
                }
            })),
        )
            .into_response(),
        GateError::BatchTooLarge { actual, max } => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": {
                    "code": "BatchTooLarge",
                    "message": format!("batch of {actual} recipients exceeds {max} cap"),
                    "actualRecipients": actual,
                    "maxRecipients": max,
                }
            })),
        )
            .into_response(),
        GateError::TokenRateLimited {
            token,
            retry_after_secs,
        } => {
            // Strip the token to a non-reversible tail so error
            // surface doesn't echo raw device identifiers to logs.
            let tail = token
                .chars()
                .rev()
                .take(8)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            (
                StatusCode::TOO_MANY_REQUESTS,
                [("retry-after", retry_after_secs.to_string())],
                Json(json!({
                    "error": {
                        "code": "TokenRateLimited",
                        "message": "token send rate exceeded — likely host-app integration bug",
                        "tokenTail": tail,
                        "retryAfterSecs": retry_after_secs,
                    }
                })),
            )
                .into_response()
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

// ── v2.26 confirmed delivery ack ───────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckRequest {
    /// Originating session id from the host app. NULL when the host
    /// hasn't surfaced a session (e.g. cold-launched from a tap).
    /// Stored verbatim in `push_sends.ack_session_id` so v2.27
    /// correlation can join on it.
    session_id: Option<String>,
    /// `"received"` (delivered to OS notification center) /
    /// `"opened"` (user tapped) / `"dismissed"`. Currently observed
    /// only for tracing; the schema records first-ack wall-clock,
    /// not per-event.
    #[allow(dead_code)]
    event_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AckResponse {
    /// Always true on a 200.
    acked: bool,
    /// True when this call was the one that flipped `acked_at` from
    /// NULL → now. Subsequent calls return `firstAck: false`.
    first_ack: bool,
}

/// v2.26 — receive confirmed-delivery ack from the SDK. Idempotent:
/// first ack records timestamp + session; subsequent acks no-op.
///
/// This is the SDK side of the Observability link-through ironclad
/// rule (#4). `push_sends.acked_at` flips from NULL to wall-clock
/// when the device's OS notification center accepts the push; the
/// v2.27 push-correlation BI joins on this column to compute
/// dispatch-vs-delivery ratios per provider / per project / per
/// campaign.
pub async fn ack_send(
    State(state): State<AppState>,
    Extension(caller): Extension<IngestCaller>,
    Path(handle): Path<String>,
    Json(body): Json<AckRequest>,
) -> Response {
    let Some(send_uuid) = parse_send_id(&handle) else {
        return bad_request(format!("invalid send id '{handle}'"));
    };
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let project_id = caller_project_id(&caller, &state);

    // Single UPDATE — only writes when `acked_at` is currently NULL
    // and the send belongs to the calling project. Returns 1 if it
    // was the first ack, 0 if already acked.
    let rows_affected = match sqlx::query(
        "UPDATE push_sends \
         SET acked_at = now(), \
             ack_session_id = COALESCE($3, ack_session_id) \
         WHERE id = $1 \
           AND project_id = $2 \
           AND acked_at IS NULL",
    )
    .bind(send_uuid)
    .bind(project_id)
    .bind(body.session_id.as_deref())
    .execute(pool)
    .await
    {
        Ok(r) => r.rows_affected(),
        Err(e) => {
            tracing::warn!(error = %e, send_id = %send_uuid, "push ack update failed");
            return internal_error();
        }
    };

    if rows_affected == 0 {
        // Either already acked OR row not found. Check which.
        let exists: Option<(uuid::Uuid,)> = sqlx::query_as(
            "SELECT id FROM push_sends WHERE id = $1 AND project_id = $2",
        )
        .bind(send_uuid)
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
        if exists.is_none() {
            return not_found(format!("send '{handle}' not found"));
        }
        // Already acked — idempotent success.
        return (
            StatusCode::OK,
            Json(AckResponse {
                acked: true,
                first_ack: false,
            }),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(AckResponse {
            acked: true,
            first_ack: true,
        }),
    )
        .into_response()
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

    // v2.20 send-API gate. Translate first (cheap, no DB), check
    // total recipient count + per-message payload size, then enter
    // the dispatch loop. Per-token rate is checked inside the loop
    // so a 429 on token N doesn't poison enqueues 1..N.
    let natives: Vec<NativeMessage> = expo_msgs
        .into_iter()
        .map(expo_compat::to_native)
        .collect();
    let total_recipients: usize = natives.iter().map(|n| n.to.as_vec().len()).sum();
    if let Err(err) = crate::push::send_gate::check_batch_size(total_recipients) {
        return gate_error_response(err);
    }
    for native in &natives {
        let payload_bytes = serde_json::to_vec(native).map(|v| v.len()).unwrap_or(0);
        if let Err(err) = crate::push::send_gate::check_payload_size(payload_bytes) {
            return gate_error_response(err);
        }
    }

    let mut response_tickets = Vec::with_capacity(natives.len());
    for native in natives {
        // Each Expo message can carry an array `to` (Expo batches
        // up-to-N tokens per call). We enqueue and emit one
        // ExpoTicket per recipient.
        let recipients = native.to.as_vec();
        for recipient in recipients {
            // v2.20 send-API gate: per-token rate is checked here
            // (instead of pre-loop) so a 429 on token N doesn't waste
            // enqueues 1..N. On rate hit, surface an Expo-shaped
            // error ticket for THIS recipient and continue — keeps
            // the response indexable by input position.
            if let Err(err) = state.send_gate.check_and_record_token(&recipient).await {
                response_tickets.push(expo_compat::ExpoTicket::Error {
                    id: None,
                    message: err.code().into(),
                    details: None,
                });
                continue;
            }
            // Reshape the multi-recipient native message into a
            // single-recipient one so enqueue_send returns exactly
            // one ticket per Expo loop iteration.
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

// ── admin credential CRUD ──────────────────────────────────────────────
//
// `/admin/api/projects/:project_id/push/credentials`:
//   GET    → list per-provider rows (config + updated_at only;
//            the encrypted secret is NEVER returned)
//   PUT    → upsert one provider row; body carries plaintext secret,
//            which is sealed before insertion
//   DELETE /:provider  → remove that provider for the project
//
// Auth: `require_admin` middleware on the admin_protected router,
// same shape as `tokens::list_tokens` / `create_token`. Role check
// (owner/admin in the project's org) is enforced before write ops.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminCredentialRow {
    provider: String,
    config: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: time::OffsetDateTime,
}

pub async fn admin_list_credentials(
    State(state): State<AppState>,
    Path(project_id): Path<uuid::Uuid>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let raw: Vec<(String, serde_json::Value, time::OffsetDateTime)> = sqlx::query_as(
        "SELECT provider, config, updated_at \
         FROM push_credentials \
         WHERE project_id = $1 \
         ORDER BY provider",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let rows: Vec<AdminCredentialRow> = raw
        .into_iter()
        .map(|(provider, config, updated_at)| AdminCredentialRow {
            provider,
            config,
            updated_at,
        })
        .collect();
    (StatusCode::OK, Json(rows)).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertCredentialBody {
    pub provider: String,
    pub config: serde_json::Value,
    /// Plaintext secret payload — provider-specific shape per
    /// `docs/design/push-architecture.md`. Sealed by `secrets::seal`
    /// before INSERT; never logged.
    pub secret: serde_json::Value,
}

pub async fn admin_upsert_credential(
    State(state): State<AppState>,
    Path(project_id): Path<uuid::Uuid>,
    Json(body): Json<UpsertCredentialBody>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let valid = matches!(
        body.provider.as_str(),
        "apns" | "fcm" | "webpush" | "hcm" | "mipush"
    );
    if !valid {
        return bad_request(format!("invalid provider '{}'", body.provider));
    }
    let secret_bytes = match serde_json::to_vec(&body.secret) {
        Ok(b) => b,
        Err(e) => return bad_request(format!("secret serialize: {e}")),
    };
    let (ciphertext, nonce) = match crate::secrets::seal(
        state.session_secret.as_bytes(),
        &secret_bytes,
    ) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "push cred seal failed");
            return internal_error();
        }
    };
    let row_id = uuid::Uuid::now_v7();
    let res = sqlx::query(
        "INSERT INTO push_credentials \
            (id, project_id, provider, config, secret_blob, secret_nonce) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (project_id, provider) DO UPDATE SET \
            config = EXCLUDED.config, \
            secret_blob = EXCLUDED.secret_blob, \
            secret_nonce = EXCLUDED.secret_nonce, \
            updated_at = now()",
    )
    .bind(row_id)
    .bind(project_id)
    .bind(&body.provider)
    .bind(&body.config)
    .bind(&ciphertext)
    .bind(&nonce)
    .execute(pool)
    .await;
    match res {
        Ok(_) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "push cred upsert failed");
            internal_error()
        }
    }
}

pub async fn admin_delete_credential(
    State(state): State<AppState>,
    Path((project_id, provider)): Path<(uuid::Uuid, String)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let res = sqlx::query(
        "DELETE FROM push_credentials WHERE project_id = $1 AND provider = $2",
    )
    .bind(project_id)
    .bind(&provider)
    .execute(pool)
    .await;
    match res {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "push cred delete failed");
            internal_error()
        }
    }
}

// ── v2.19 admin monitoring + management ─────────────────────────────────
//
// Seven endpoints surfacing the push subsystem's runtime state to the
// dashboard. Read-mostly (one mutation: retry). Auth: `require_admin`
// same as the credential CRUD above.
//
//   GET    /admin/api/projects/:id/push/stats              — KPI overview
//   GET    /admin/api/projects/:id/push/devices            — paginated tokens
//   GET    /admin/api/projects/:id/push/sends              — paginated sends
//   GET    /admin/api/projects/:id/push/sends/:sendId      — send detail
//   POST   /admin/api/projects/:id/push/sends/:sendId/retry — clone + re-queue
//   POST   /admin/api/projects/:id/push/credentials/:provider/verify — vendor ping
//   GET    /admin/api/orgs/:slug/push/projects             — org fleet view

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProviderRollup {
    sent_24h: i64,
    failed_24h: i64,
    queued: i64,
    devices_active: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushStatsResponse {
    queued_total: i64,
    sent_24h_total: i64,
    failed_24h_total: i64,
    devices_active_total: i64,
    per_provider: std::collections::BTreeMap<String, ProviderRollup>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    last_send_at: Option<time::OffsetDateTime>,
}

/// v2.19 — KPI overview for one project's push subsystem. Drives the
/// Push module's Overview tab.
pub async fn admin_push_stats(
    State(state): State<AppState>,
    Path(project_id): Path<uuid::Uuid>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };

    // Rollup over push_sends in the last 24h, grouped by provider +
    // outcome status. A separate query rolls up device_tokens
    // because device counts are independent of send activity.
    let sends_rows: Vec<(String, String, i64)> = match sqlx::query_as(
        "SELECT provider, status, COUNT(*)::bigint \
         FROM push_sends \
         WHERE project_id = $1 \
           AND (status = 'queued' OR created_at >= now() - INTERVAL '24 hours') \
         GROUP BY provider, status",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "push stats sends rollup failed");
            return internal_error();
        }
    };

    let device_rows: Vec<(String, i64)> = match sqlx::query_as(
        "SELECT provider, COUNT(*)::bigint \
         FROM device_tokens \
         WHERE project_id = $1 AND revoked_at IS NULL \
         GROUP BY provider",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "push stats devices rollup failed");
            return internal_error();
        }
    };

    let last_send_at: Option<time::OffsetDateTime> = sqlx::query_scalar(
        "SELECT MAX(COALESCE(sent_at, created_at)) FROM push_sends WHERE project_id = $1",
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .unwrap_or(None);

    let mut per: std::collections::BTreeMap<String, ProviderRollup> = std::collections::BTreeMap::new();
    let mut queued_total = 0i64;
    let mut sent_total = 0i64;
    let mut failed_total = 0i64;
    let mut devices_total = 0i64;
    for (provider, status, count) in sends_rows {
        let bucket = per.entry(provider).or_default();
        match status.as_str() {
            "queued" => {
                bucket.queued = count;
                queued_total += count;
            }
            "sent" => {
                bucket.sent_24h = count;
                sent_total += count;
            }
            "failed" => {
                bucket.failed_24h = count;
                failed_total += count;
            }
            _ => {}
        }
    }
    for (provider, count) in device_rows {
        let bucket = per.entry(provider).or_default();
        bucket.devices_active = count;
        devices_total += count;
    }

    (
        StatusCode::OK,
        Json(PushStatsResponse {
            queued_total,
            sent_24h_total: sent_total,
            failed_24h_total: failed_total,
            devices_active_total: devices_total,
            per_provider: per,
            last_send_at,
        }),
    )
        .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeviceTokenRow {
    id: uuid::Uuid,
    provider: String,
    env: Option<String>,
    bad_streak: i32,
    #[serde(default, with = "time::serde::rfc3339::option")]
    revoked_at: Option<time::OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    last_seen_at: time::OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    created_at: time::OffsetDateTime,
    user_fingerprint_hex: Option<String>,
    metadata: serde_json::Value,
}

#[derive(Deserialize)]
pub struct ListDevicesQuery {
    /// Caller-controlled page size; clamped to 1..=200.
    #[serde(default)]
    pub limit: Option<i32>,
    /// `created_at < cursor` for keyset pagination.
    #[serde(default)]
    pub cursor: Option<String>,
    /// Filter by provider.
    #[serde(default)]
    pub provider: Option<String>,
}

/// v2.19 — paginated device_tokens for one project. Drives the Push
/// module's Devices tab.
pub async fn admin_list_push_devices(
    State(state): State<AppState>,
    Path(project_id): Path<uuid::Uuid>,
    axum::extract::Query(q): axum::extract::Query<ListDevicesQuery>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let cursor_ts = q
        .cursor
        .as_deref()
        .and_then(parse_rfc3339_cursor);
    let provider_filter = q.provider.as_deref();

    let rows: Vec<(
        uuid::Uuid,
        String,
        Option<String>,
        i32,
        Option<time::OffsetDateTime>,
        time::OffsetDateTime,
        time::OffsetDateTime,
        Option<Vec<u8>>,
        serde_json::Value,
    )> = match sqlx::query_as(
        "SELECT id, provider, env, bad_streak, revoked_at, last_seen_at, \
                created_at, user_fingerprint_hex, metadata \
         FROM device_tokens \
         WHERE project_id = $1 \
           AND ($2::text IS NULL OR provider = $2) \
           AND ($3::timestamptz IS NULL OR created_at < $3) \
         ORDER BY created_at DESC \
         LIMIT $4",
    )
    .bind(project_id)
    .bind(provider_filter)
    .bind(cursor_ts)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "push devices list failed");
            return internal_error();
        }
    };

    let items: Vec<DeviceTokenRow> = rows
        .into_iter()
        .map(
            |(id, provider, env, bad_streak, revoked_at, last_seen_at, created_at, fp, metadata)| {
                DeviceTokenRow {
                    id,
                    provider,
                    env,
                    bad_streak,
                    revoked_at,
                    last_seen_at,
                    created_at,
                    user_fingerprint_hex: fp.map(hex::encode),
                    metadata,
                }
            },
        )
        .collect();
    let next_cursor = items
        .last()
        .map(|row| row.created_at.format(&time::format_description::well_known::Rfc3339).unwrap_or_default());

    (
        StatusCode::OK,
        Json(json!({ "items": items, "nextCursor": next_cursor })),
    )
        .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushSendRow {
    id: uuid::Uuid,
    token_id: uuid::Uuid,
    provider: String,
    status: String,
    provider_outcome: Option<String>,
    error: Option<String>,
    retry_count: i32,
    #[serde(with = "time::serde::rfc3339")]
    next_attempt_at: time::OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    created_at: time::OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    sent_at: Option<time::OffsetDateTime>,
    payload_preview: serde_json::Value,
}

#[derive(Deserialize)]
pub struct ListSendsQuery {
    #[serde(default)]
    pub limit: Option<i32>,
    #[serde(default)]
    pub cursor: Option<String>,
    /// `queued|sent|failed`.
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    /// Filter sends targeting one specific token handle.
    #[serde(default)]
    pub token_id: Option<uuid::Uuid>,
}

/// v2.19 — paginated push_sends for one project. Drives the Push
/// module's Sends tab.
pub async fn admin_list_push_sends(
    State(state): State<AppState>,
    Path(project_id): Path<uuid::Uuid>,
    axum::extract::Query(q): axum::extract::Query<ListSendsQuery>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let cursor_ts = q.cursor.as_deref().and_then(parse_rfc3339_cursor);
    let status_filter = q.status.as_deref();
    let provider_filter = q.provider.as_deref();

    let rows: Vec<(
        uuid::Uuid,
        uuid::Uuid,
        String,
        String,
        Option<String>,
        Option<String>,
        i32,
        time::OffsetDateTime,
        time::OffsetDateTime,
        Option<time::OffsetDateTime>,
        serde_json::Value,
    )> = match sqlx::query_as(
        "SELECT id, token_id, provider, status, provider_outcome, error, \
                retry_count, next_attempt_at, created_at, sent_at, payload \
         FROM push_sends \
         WHERE project_id = $1 \
           AND ($2::text IS NULL OR status = $2) \
           AND ($3::text IS NULL OR provider = $3) \
           AND ($4::uuid IS NULL OR token_id = $4) \
           AND ($5::timestamptz IS NULL OR created_at < $5) \
         ORDER BY created_at DESC \
         LIMIT $6",
    )
    .bind(project_id)
    .bind(status_filter)
    .bind(provider_filter)
    .bind(q.token_id)
    .bind(cursor_ts)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "push sends list failed");
            return internal_error();
        }
    };

    let items: Vec<PushSendRow> = rows
        .into_iter()
        .map(
            |(
                id,
                token_id,
                provider,
                status,
                provider_outcome,
                error,
                retry_count,
                next_attempt_at,
                created_at,
                sent_at,
                payload,
            )| PushSendRow {
                id,
                token_id,
                provider,
                status,
                provider_outcome,
                error,
                retry_count,
                next_attempt_at,
                created_at,
                sent_at,
                payload_preview: payload_summary(&payload),
            },
        )
        .collect();
    let next_cursor = items
        .last()
        .map(|row| row.created_at.format(&time::format_description::well_known::Rfc3339).unwrap_or_default());

    (
        StatusCode::OK,
        Json(json!({ "items": items, "nextCursor": next_cursor })),
    )
        .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DeliveryLogEntry {
    attempt: i32,
    outcome: String,
    provider_status: Option<i32>,
    provider_body: Option<String>,
    duration_ms: Option<i32>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: time::OffsetDateTime,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SendDetailResponse {
    send: serde_json::Value,
    delivery_logs: Vec<DeliveryLogEntry>,
    device_present: bool,
    device_provider: Option<String>,
}

/// v2.19 — single send + its full delivery_logs timeline. Drives
/// the send-detail sub-route.
pub async fn admin_get_push_send_detail(
    State(state): State<AppState>,
    Path((project_id, send_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };

    let send_row: Option<(
        uuid::Uuid,
        uuid::Uuid,
        String,
        String,
        Option<String>,
        Option<String>,
        i32,
        Option<String>,
        time::OffsetDateTime,
        time::OffsetDateTime,
        Option<time::OffsetDateTime>,
        serde_json::Value,
    )> = sqlx::query_as(
        "SELECT id, token_id, provider, status, provider_outcome, error, \
                retry_count, idempotency_key, next_attempt_at, created_at, sent_at, payload \
         FROM push_sends \
         WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let Some(send_row) = send_row else {
        return not_found(format!("send '{send_id}' not found"));
    };
    let (
        id,
        token_id,
        provider,
        status,
        provider_outcome,
        error,
        retry_count,
        idempotency_key,
        next_attempt_at,
        created_at,
        sent_at,
        payload,
    ) = send_row;

    let log_rows: Vec<(
        i32,
        String,
        Option<i32>,
        Option<String>,
        Option<i32>,
        time::OffsetDateTime,
    )> = sqlx::query_as(
        "SELECT attempt, outcome, provider_status, provider_body, duration_ms, created_at \
         FROM push_delivery_logs \
         WHERE send_id = $1 \
         ORDER BY attempt ASC, created_at ASC",
    )
    .bind(send_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let device_row: Option<(String, Option<time::OffsetDateTime>)> = sqlx::query_as(
        "SELECT provider, revoked_at FROM device_tokens WHERE id = $1",
    )
    .bind(token_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let send_payload = json!({
        "id": id,
        "tokenId": token_id,
        "provider": provider,
        "status": status,
        "providerOutcome": provider_outcome,
        "error": error,
        "retryCount": retry_count,
        "idempotencyKey": idempotency_key,
        "nextAttemptAt": next_attempt_at,
        "createdAt": created_at,
        "sentAt": sent_at,
        "payload": payload,
    });
    let logs: Vec<DeliveryLogEntry> = log_rows
        .into_iter()
        .map(
            |(attempt, outcome, provider_status, provider_body, duration_ms, created_at)| {
                DeliveryLogEntry {
                    attempt,
                    outcome,
                    provider_status,
                    provider_body,
                    duration_ms,
                    created_at,
                }
            },
        )
        .collect();

    let (device_present, device_provider) = match device_row {
        Some((p, None)) => (true, Some(p)),
        Some((p, Some(_))) => (false, Some(p)),
        None => (false, None),
    };

    (
        StatusCode::OK,
        Json(SendDetailResponse {
            send: send_payload,
            delivery_logs: logs,
            device_present,
            device_provider,
        }),
    )
        .into_response()
}

/// v2.19 — re-queue one failed (or even sent) push. Clones the
/// row's payload + token + provider, drops idempotency_key, inserts
/// a fresh `queued` row with `next_attempt_at = now()`. The dispatch
/// cron picks it up on the next 30 s tick.
pub async fn admin_retry_push_send(
    State(state): State<AppState>,
    Path((project_id, send_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };

    let orig: Option<(uuid::Uuid, String, serde_json::Value)> = sqlx::query_as(
        "SELECT token_id, provider, payload FROM push_sends \
         WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let Some((token_id, provider, payload)) = orig else {
        return not_found(format!("send '{send_id}' not found"));
    };

    // Don't clone into a still-active device that has since been
    // revoked — the dispatch cron would just immediately fail it.
    let token_active: Option<bool> = sqlx::query_scalar(
        "SELECT revoked_at IS NULL FROM device_tokens WHERE id = $1",
    )
    .bind(token_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    if !matches!(token_active, Some(true)) {
        return bad_request("original device token is revoked or missing — cannot retry".into());
    }

    let new_id = uuid::Uuid::now_v7();
    let res = sqlx::query(
        "INSERT INTO push_sends \
            (id, project_id, token_id, provider, payload, status, retry_count, next_attempt_at) \
         VALUES ($1, $2, $3, $4, $5, 'queued', 0, now())",
    )
    .bind(new_id)
    .bind(project_id)
    .bind(token_id)
    .bind(&provider)
    .bind(&payload)
    .execute(pool)
    .await;
    match res {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({ "sendId": new_id, "ok": true })),
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "push retry insert failed");
            internal_error()
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyCredentialResponse {
    provider: String,
    status: String, // "ok" | "rejected" | "malformed" | "unreachable" | "unverified"
    reason: Option<String>,
    duration_ms: i32,
}

/// v2.19 — exercise one credential row's auth path. Used by the
/// Credentials tab's green/red status indicator.
pub async fn admin_verify_push_credential(
    State(state): State<AppState>,
    Path((project_id, provider)): Path<(uuid::Uuid, String)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };
    let Some(providers_arc) = state.push_providers.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "providersUnavailable" })),
        )
            .into_response();
    };
    let kind = match crate::push::providers::ProviderKind::from_db(&provider) {
        Some(k) => k,
        None => return bad_request(format!("invalid provider '{provider}'")),
    };

    let row: Option<(serde_json::Value, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT config, secret_blob, secret_nonce FROM push_credentials \
         WHERE project_id = $1 AND provider = $2",
    )
    .bind(project_id)
    .bind(&provider)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let Some((config, secret_blob, secret_nonce)) = row else {
        return not_found(format!("no '{provider}' credential for project"));
    };

    let secret_payload =
        match crate::secrets::open(state.session_secret.as_bytes(), &secret_blob, &secret_nonce) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!(error = %e, "verify: cred decrypt failed");
                return (
                    StatusCode::OK,
                    Json(VerifyCredentialResponse {
                        provider,
                        status: "malformed".into(),
                        reason: Some(format!("decrypt: {e}")),
                        duration_ms: 0,
                    }),
                )
                    .into_response();
            }
        };

    let cred = crate::push::providers::Credential {
        config: &config,
        secret_payload: &secret_payload,
    };
    let t0 = std::time::Instant::now();
    let outcome = providers_arc.pick(kind).validate(cred).await;
    let duration_ms = t0.elapsed().as_millis().min(i32::MAX as u128) as i32;

    use crate::push::providers::ValidateOutcome;
    let (status, reason) = match outcome {
        ValidateOutcome::Ok => ("ok".to_string(), None),
        ValidateOutcome::Rejected { reason } => ("rejected".to_string(), Some(reason)),
        ValidateOutcome::Malformed { reason } => ("malformed".to_string(), Some(reason)),
        ValidateOutcome::Unreachable { reason } => ("unreachable".to_string(), Some(reason)),
        ValidateOutcome::NotImplemented => (
            "unverified".to_string(),
            Some("vendor exposes no cheap auth ping — shape parsed only".to_string()),
        ),
    };

    (
        StatusCode::OK,
        Json(VerifyCredentialResponse {
            provider,
            status,
            reason,
            duration_ms,
        }),
    )
        .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OrgFleetProjectRow {
    project_id: uuid::Uuid,
    project_name: String,
    providers_configured: Vec<String>,
    devices_active: i64,
    sent_24h: i64,
    failed_24h: i64,
    queued: i64,
    #[serde(default, with = "time::serde::rfc3339::option")]
    last_send_at: Option<time::OffsetDateTime>,
}

/// v2.19 — cross-project Push status. Drives the new Push fleet module
/// in the manage group: one row per project in the org, showing
/// configured providers + 24 h activity + queue depth at a glance.
pub async fn admin_list_org_push_projects(
    State(state): State<AppState>,
    Path(org_slug): Path<String>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };

    let projects: Vec<(uuid::Uuid, String)> = match sqlx::query_as(
        "SELECT p.id, p.name \
         FROM projects p \
         JOIN orgs o ON o.id = p.org_id \
         WHERE o.slug = $1 \
         ORDER BY p.created_at ASC",
    )
    .bind(&org_slug)
    .fetch_all(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "org fleet projects list failed");
            return internal_error();
        }
    };

    // One pass over push_credentials + device_tokens + push_sends,
    // per-project. We do N small queries rather than one giant JOIN
    // because the fleet view runs once per page load and N is bounded
    // by the org's project count (typically < 20).
    let mut rows: Vec<OrgFleetProjectRow> = Vec::with_capacity(projects.len());
    for (project_id, name) in projects {
        let providers: Vec<String> = sqlx::query_scalar(
            "SELECT provider FROM push_credentials WHERE project_id = $1 ORDER BY provider",
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
        let devices_active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM device_tokens \
             WHERE project_id = $1 AND revoked_at IS NULL",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        let sent_24h: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM push_sends \
             WHERE project_id = $1 AND status = 'sent' \
               AND created_at >= now() - INTERVAL '24 hours'",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        let failed_24h: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM push_sends \
             WHERE project_id = $1 AND status = 'failed' \
               AND created_at >= now() - INTERVAL '24 hours'",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        let queued: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM push_sends \
             WHERE project_id = $1 AND status = 'queued'",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0);
        let last_send_at: Option<time::OffsetDateTime> = sqlx::query_scalar(
            "SELECT MAX(COALESCE(sent_at, created_at)) FROM push_sends WHERE project_id = $1",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await
        .unwrap_or(None);

        rows.push(OrgFleetProjectRow {
            project_id,
            project_name: name,
            providers_configured: providers,
            devices_active,
            sent_24h,
            failed_24h,
            queued,
            last_send_at,
        });
    }

    (StatusCode::OK, Json(json!({ "items": rows }))).into_response()
}

// ── tiny helpers shared by the v2.19 endpoints ────────────────────────

fn parse_rfc3339_cursor(s: &str) -> Option<time::OffsetDateTime> {
    time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).ok()
}

/// Compact a push_sends.payload for list responses — full JSON can
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushSendDownstreamResponse {
    /// `"ok"` when the send has a `sent_at` (i.e. the SDK had a chance
    /// to receive + correlate). `"n/a"` when still queued / failed
    /// before delivery — counts are zero and the UI shows an empty
    /// state instead of misleading numbers.
    correlation_status: &'static str,
    event_count: i64,
    error_event_count: i64,
    distinct_sessions: i64,
    /// Seconds from `sent_at` to the first event we found for this
    /// msgId. Null when no events found.
    first_seen_secs: Option<i64>,
    last_seen_secs: Option<i64>,
    /// Window in seconds used for the query (24 h).
    window_secs: i64,
}

const DOWNSTREAM_WINDOW_SECS: i64 = 24 * 3600;

/// v2.27 — given a single push send, report on the downstream events
/// it correlates to. Reads `events_partitioned.payload->'breadcrumbs'`
/// for entries with `type='push'` and `data->>'msgId'` equal to this
/// send's id, within `[sent_at, sent_at + 24h]`.
///
/// Powers the "Downstream impact" Card in the dashboard's
/// send-detail view. Part of Observability link-through (rule #4).
pub async fn admin_get_push_send_downstream(
    State(state): State<AppState>,
    Path((project_id, send_id)): Path<(uuid::Uuid, uuid::Uuid)>,
) -> Response {
    let Some(pool) = state.db.as_ref() else {
        return db_not_configured();
    };

    let send_row: Option<(Option<time::OffsetDateTime>,)> = sqlx::query_as(
        "SELECT sent_at FROM push_sends WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(send_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);

    let Some((sent_at,)) = send_row else {
        return not_found(format!("send '{send_id}' not found"));
    };

    let Some(sent_at) = sent_at else {
        // Send never made it out. No correlation possible.
        return (
            StatusCode::OK,
            Json(PushSendDownstreamResponse {
                correlation_status: "n/a",
                event_count: 0,
                error_event_count: 0,
                distinct_sessions: 0,
                first_seen_secs: None,
                last_seen_secs: None,
                window_secs: DOWNSTREAM_WINDOW_SECS,
            }),
        )
            .into_response();
    };

    let msg_id = crate::push::types::format_send_id(send_id);
    let until = sent_at + time::Duration::seconds(DOWNSTREAM_WINDOW_SECS);

    // Partition-prune on received_at + JSONB containment match for
    // breadcrumbs with type=push and matching msgId. The @> operator
    // tests whether the breadcrumbs array contains the given object —
    // index-aware via the default GIN on JSONB containment if present.
    let containment = serde_json::json!([
        { "type": "push", "data": { "msgId": msg_id } }
    ]);

    let agg: (i64, i64, i64, Option<time::OffsetDateTime>, Option<time::OffsetDateTime>) =
        match sqlx::query_as(
            "SELECT COUNT(*)::bigint AS evt, \
                    COUNT(*) FILTER (WHERE error_type IS NOT NULL AND error_type <> '')::bigint AS err, \
                    COUNT(DISTINCT (payload->'session'->>'id'))::bigint AS sess, \
                    MIN(received_at) AS first_seen, \
                    MAX(received_at) AS last_seen \
             FROM events_partitioned \
             WHERE project_id = $1 \
               AND received_at >= $2 \
               AND received_at <= $3 \
               AND payload->'breadcrumbs' @> $4",
        )
        .bind(project_id)
        .bind(sent_at)
        .bind(until)
        .bind(&containment)
        .fetch_one(pool)
        .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = %e, "push downstream impact query failed");
                return internal_error();
            }
        };

    let (event_count, error_event_count, distinct_sessions, first_seen, last_seen) = agg;

    fn delta_secs(
        from: time::OffsetDateTime,
        to: Option<time::OffsetDateTime>,
    ) -> Option<i64> {
        to.map(|t| (t - from).whole_seconds())
    }

    (
        StatusCode::OK,
        Json(PushSendDownstreamResponse {
            correlation_status: "ok",
            event_count,
            error_event_count,
            distinct_sessions,
            first_seen_secs: delta_secs(sent_at, first_seen),
            last_seen_secs: delta_secs(sent_at, last_seen),
            window_secs: DOWNSTREAM_WINDOW_SECS,
        }),
    )
        .into_response()
}

/// be 2 KB+ each. We surface only the fields the dashboard renders
/// as a one-liner: title, body, deep-link.
fn payload_summary(payload: &serde_json::Value) -> serde_json::Value {
    let mut out = serde_json::Map::new();
    for key in ["title", "body"] {
        if let Some(v) = payload.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
    if let Some(data) = payload.get("data") {
        if let Some(link) = data.get("deepLink").or_else(|| data.get("deep_link")) {
            out.insert("deepLink".into(), link.clone());
        }
    }
    serde_json::Value::Object(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderHealthSnapshot {
    provider: String,
    invalid_rate: f64,
    in_window_total: u32,
    auto_throttle: bool,
    /// `max(0, (threshold - invalid_rate) / threshold * 100)`. 100 =
    /// fully healthy (no in-window invalid); 0 = at or past the
    /// auto-throttle threshold. The dashboard renders this as a
    /// "distance to throttle" gauge.
    safety_margin_pct: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushHealthResponse {
    providers: Vec<ProviderHealthSnapshot>,
    /// Window size in seconds (matches `HEALTH_WINDOW`). Dashboard
    /// renders this in the card subtitle so operators know what the
    /// numbers cover.
    window_secs: u64,
    /// `invalid_rate` at which `auto_throttle` flips on. Dashboard
    /// uses to label the gauge tick.
    threshold_ratio: f64,
}

/// v2.24 — expose the v2.23 in-memory `HealthState` snapshot. Powers
/// the Provider Health card in the Push module's Overview tab. Reads
/// from process memory only — no DB query.
pub async fn admin_push_health(
    State(state): State<AppState>,
    Path(project_id): Path<uuid::Uuid>,
) -> Response {
    let Some(providers_arc) = state.push_providers.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "providersUnavailable" })),
        )
            .into_response();
    };
    let health = &providers_arc.health;
    let threshold = crate::push::health::AUTO_THROTTLE_INVALID_RATIO;

    let mut snapshots = Vec::with_capacity(5);
    for kind in [
        crate::push::providers::ProviderKind::Apns,
        crate::push::providers::ProviderKind::Fcm,
        crate::push::providers::ProviderKind::WebPush,
        crate::push::providers::ProviderKind::Hcm,
        crate::push::providers::ProviderKind::MiPush,
    ] {
        let invalid_rate = health.invalid_rate(project_id, kind).await;
        let in_window_total = health.in_window_total(project_id, kind).await;
        let auto_throttle = health.should_auto_throttle(project_id, kind).await;
        let safety_margin_pct = if in_window_total == 0 {
            // No samples — show "fully healthy" rather than a misleading 0.
            100.0
        } else {
            ((threshold - invalid_rate) / threshold).max(0.0) * 100.0
        };
        snapshots.push(ProviderHealthSnapshot {
            provider: kind.as_str().into(),
            invalid_rate,
            in_window_total,
            auto_throttle,
            safety_margin_pct,
        });
    }

    (
        StatusCode::OK,
        Json(PushHealthResponse {
            providers: snapshots,
            window_secs: crate::push::health::HEALTH_WINDOW.as_secs(),
            threshold_ratio: threshold,
        }),
    )
        .into_response()
}
