//! POST `/v1/push/send` — queue a push for delivery.
//!
//! Phase D step 4 queues the push to `push_sends` in `queued`
//! status. A background worker (out-of-scope for this commit;
//! Phase D step 5+ adds the dispatcher loop) drains the queue,
//! calls the vendor (APNs / FCM / WebPush / HCM / MiPush), and
//! writes `push_delivery_logs` rows + flips `push_sends.status`.

use std::sync::Arc;

use axum::{Extension, Json, extract::State, http::StatusCode};
use sentori_ingest_token::IngestContext;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tracing::{info, warn};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendBody {
    /// Target by:
    /// - `tokenIds`: explicit device_token UUIDs
    /// - OR `nativeTokens`: list of provider tokens
    /// - OR `topic`: dispatch to every device subscribed to topic
    /// - OR `appUserId`: app-side user id (all devices)
    #[serde(default)]
    pub token_ids: Vec<Uuid>,
    #[serde(default)]
    pub native_tokens: Vec<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub app_user_id: Option<String>,
    /// Vendor payload (passed through verbatim to vendor adapter).
    pub payload: Value,
    /// Caller-supplied dedup key.
    #[serde(default)]
    pub idempotency_key: Option<String>,
    #[serde(default)]
    pub campaign_id: Option<String>,
    #[serde(default)]
    pub template_id: Option<String>,
}

pub async fn handle(
    Extension(ctx): Extension<IngestContext>,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SendBody>,
) -> (StatusCode, Json<Value>) {
    // Resolve target → list of (device_token_id, provider).
    let targets = match resolve_targets(&state, &ctx, &body).await {
        Ok(t) => t,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "bad_target", "detail": msg })),
            );
        }
    };

    if targets.is_empty() {
        return (
            StatusCode::ACCEPTED,
            Json(json!({ "send_ids": [], "queued": 0 })),
        );
    }

    // Enqueue one push_sends row per target.
    let mut send_ids: Vec<String> = Vec::with_capacity(targets.len());
    let mut queued = 0u32;
    for (token_id, provider) in targets {
        let id = Uuid::now_v7();
        let result = sqlx::query(
            "INSERT INTO push_sends \
             (id, workspace_id, project_id, token_id, provider, payload, status, idempotency_key, campaign_id, template_id) \
             VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9) \
             ON CONFLICT (project_id, idempotency_key) DO NOTHING \
             RETURNING id",
        )
        .bind(id)
        .bind(ctx.workspace_id.into_uuid())
        .bind(ctx.project_id.into_uuid())
        .bind(token_id)
        .bind(&provider)
        .bind(&body.payload)
        .bind(body.idempotency_key.as_deref())
        .bind(body.campaign_id.as_deref())
        .bind(body.template_id.as_deref())
        .fetch_optional(&state.pool)
        .await;
        match result {
            Ok(Some(_)) => {
                send_ids.push(id.to_string());
                queued += 1;
            }
            Ok(None) => {
                // Idempotency conflict — already queued.
            }
            Err(e) => {
                warn!(error = %e, "push.send insert_failed");
            }
        }
    }

    info!(
        workspace_id = %ctx.workspace_id,
        project_id = %ctx.project_id,
        queued,
        "push.send queued",
    );
    (
        StatusCode::ACCEPTED,
        Json(json!({ "send_ids": send_ids, "queued": queued })),
    )
}

async fn resolve_targets(
    state: &Arc<AppState>,
    ctx: &IngestContext,
    body: &SendBody,
) -> Result<Vec<(Uuid, String)>, String> {
    let mut out: Vec<(Uuid, String)> = Vec::new();

    if !body.token_ids.is_empty() {
        let rows = sqlx::query(
            "SELECT id, provider FROM device_tokens \
             WHERE project_id = $1 AND revoked_at IS NULL AND id = ANY($2)",
        )
        .bind(ctx.project_id.into_uuid())
        .bind(&body.token_ids)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
        for r in rows {
            out.push((r.get("id"), r.get("provider")));
        }
    }

    if !body.native_tokens.is_empty() {
        let rows = sqlx::query(
            "SELECT id, provider FROM device_tokens \
             WHERE project_id = $1 AND revoked_at IS NULL AND native_token = ANY($2)",
        )
        .bind(ctx.project_id.into_uuid())
        .bind(&body.native_tokens)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
        for r in rows {
            out.push((r.get("id"), r.get("provider")));
        }
    }

    if let Some(ref topic) = body.topic {
        let rows = sqlx::query(
            "SELECT dt.id, dt.provider FROM device_tokens dt \
             JOIN device_topics tt ON tt.device_token_id = dt.id \
             WHERE dt.project_id = $1 AND dt.revoked_at IS NULL AND tt.topic = $2",
        )
        .bind(ctx.project_id.into_uuid())
        .bind(topic)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
        for r in rows {
            out.push((r.get("id"), r.get("provider")));
        }
    }

    // De-duplicate by token_id.
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.dedup_by_key(|t| t.0);
    Ok(out)
}
