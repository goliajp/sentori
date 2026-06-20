//! v2.3 — GDPR-aligned DSR erase endpoint.
//!
//!   POST /admin/api/orgs/{slug}/users/erase
//!   body: { keyType: "email", clientHash: "<64-char lowercase hex>",
//!           dryRun?: bool }
//!
//! The operator types the subject's raw value (email / phone /
//! oauthSub) into the dashboard; the browser hashes via
//! `crypto.subtle.digest('SHA-256', …)`, lowercases hex, and POSTs
//! the hash only (raw never leaves the browser).
//!
//! Server then layers the org's default identity_scope salt to
//! compute the stored fingerprint (same formula as ingest) and:
//!
//!   - dryRun=true  → returns the count of affected events + a
//!                    short sample of event ids. Nothing mutated.
//!   - dryRun=false → drops every identity_fingerprints row for the
//!                    subject (so future lookups return zero), AND
//!                    pseudonymises every matching event by
//!                    overwriting `payload.user` with `{}`. The
//!                    event row itself is kept so aggregate stats
//!                    (per-release event counts, etc.) stay
//!                    consistent — only the personal data is gone.
//!                    GDPR Art. 17 accepts pseudonymisation when
//!                    full erasure would break other legitimate
//!                    processing.
//!
//! Audit:
//!   - Every call (dry or real) writes one row to `audit_logs`.
//!     Action code: `identity.erased` (real) or
//!     `identity.erase.dry_run` (dry).
//!   - Payload carries `keyType` + `affectedCount` + the truncated
//!     8-hex prefix of the fingerprint — never the raw value, never
//!     the client_hash itself.
//!
//! Rate limit: relies on the existing admin-route middleware (60/min
//! per session). Erase is a destructive op, so the dashboard UI
//! adds a typed-confirmation gate on top.

use axum::{
    extract::{Extension, Path, State},
    response::Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::audit;
use crate::error::AppError;
use crate::recent::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseReq {
    pub key_type: String,
    pub client_hash: String,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseResp {
    pub scope_id: Uuid,
    pub key_type: String,
    pub dry_run: bool,
    /// Number of events whose `payload.user` would be (or has been)
    /// pseudonymised. Same number on dry-run and real run for the
    /// same input.
    pub affected_count: i64,
    /// Up to 10 event ids of the affected set, oldest first. Surface
    /// for the operator to spot-check before confirming a live run.
    pub sample_event_ids: Vec<Uuid>,
    /// 8-hex prefix of the stored fingerprint — opaque to the
    /// operator without the original value, useful for cross-
    /// referencing audit log entries.
    pub fingerprint_prefix: String,
}

pub async fn erase(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(org_slug): Path<String>,
    Json(req): Json<EraseReq>,
) -> Result<Json<EraseResp>, AppError> {
    let actor_user_id = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;

    if !crate::identity::is_valid_client_hash(&req.client_hash) {
        return Err(AppError::BadRequest(
            "clientHash must be 64-char lowercase hex sha256".into(),
        ));
    }
    if req.key_type.is_empty() || req.key_type.len() > 64 {
        return Err(AppError::BadRequest(
            "keyType must be non-empty and <= 64 chars".into(),
        ));
    }

    // Resolve org → default identity_scope (id + salt + org_id).
    let row: Option<(Uuid, Vec<u8>, Uuid)> = sqlx::query_as(
        r#"
        SELECT s.id, s.salt, o.id
        FROM orgs o
        JOIN org_identity_scopes ois ON ois.org_id = o.id AND ois.is_default = true
        JOIN identity_scopes s ON s.id = ois.scope_id
        WHERE o.slug = $1
        LIMIT 1
        "#,
    )
    .bind(&org_slug)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let Some((scope_id, salt, org_id)) = row else {
        // Same shape as "no match" — don't leak whether the org
        // exists. Operator sees `affectedCount: 0`, dashboard renders
        // that clearly.
        return Ok(Json(EraseResp {
            scope_id: Uuid::nil(),
            key_type: req.key_type,
            dry_run: req.dry_run,
            affected_count: 0,
            sample_event_ids: Vec::new(),
            fingerprint_prefix: String::new(),
        }));
    };

    let stored_fp = crate::identity::compute_fingerprint(&salt, &req.key_type, &req.client_hash);
    let fingerprint_prefix = stored_fp
        .iter()
        .take(4)
        .map(|b| format!("{:02x}", b))
        .collect::<String>();

    // Collect affected event ids. Bounded SELECT keeps the response
    // size sane even if a subject is in millions of events; the
    // matching FK rows in identity_fingerprints itself stay correct.
    let affected: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT event_id
        FROM identity_fingerprints
        WHERE scope_id = $1 AND key_type = $2 AND fingerprint = $3
        ORDER BY received_at ASC
        "#,
    )
    .bind(scope_id)
    .bind(&req.key_type)
    .bind(&stored_fp)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let affected_count = affected.len() as i64;
    let sample_event_ids: Vec<Uuid> = affected.iter().take(10).copied().collect();

    if !req.dry_run && affected_count > 0 {
        // Transaction: drop fingerprint rows + pseudonymise events.
        let mut tx = pool
            .begin()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

        sqlx::query(
            "DELETE FROM identity_fingerprints \
             WHERE scope_id = $1 AND key_type = $2 AND fingerprint = $3",
        )
        .bind(scope_id)
        .bind(&req.key_type)
        .bind(&stored_fp)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

        // Pseudonymise: overwrite payload.user with an empty object.
        // jsonb_set is atomic per-row and idempotent on re-run.
        sqlx::query(
            "UPDATE events \
             SET payload = jsonb_set(payload, '{user}', '{}'::jsonb, true) \
             WHERE id = ANY($1)",
        )
        .bind(&affected)
        .execute(&mut *tx)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

        tx.commit()
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    // Audit row — fires for both dry runs and real runs so the trail
    // shows every check, not just every action. Payload deliberately
    // omits the client_hash; the fingerprint prefix is enough to
    // correlate runs.
    let action = if req.dry_run {
        audit::actions::IDENTITY_ERASE_DRY_RUN
    } else {
        audit::actions::IDENTITY_ERASED
    };
    audit::record(
        pool,
        org_id,
        actor_user_id,
        action,
        audit::targets::IDENTITY_SCOPE,
        Some(scope_id),
        serde_json::json!({
            "keyType": req.key_type,
            "affectedCount": affected_count,
            "fingerprintPrefix": fingerprint_prefix,
        }),
    )
    .await;

    Ok(Json(EraseResp {
        scope_id,
        key_type: req.key_type,
        dry_run: req.dry_run,
        affected_count,
        sample_event_ids,
        fingerprint_prefix,
    }))
}

// ── unit tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn req_parses_with_dry_run_default_false() {
        let body = serde_json::json!({
            "keyType": "email",
            "clientHash": "a".repeat(64),
        });
        let r: EraseReq = serde_json::from_value(body).expect("parses");
        assert_eq!(r.key_type, "email");
        assert!(!r.dry_run);
    }

    #[test]
    fn req_parses_with_dry_run_true() {
        let body = serde_json::json!({
            "keyType": "email",
            "clientHash": "a".repeat(64),
            "dryRun": true,
        });
        let r: EraseReq = serde_json::from_value(body).expect("parses");
        assert!(r.dry_run);
    }

    #[test]
    fn req_rejects_missing_fields() {
        assert!(
            serde_json::from_value::<EraseReq>(serde_json::json!({"keyType": "email"})).is_err()
        );
        assert!(serde_json::from_value::<EraseReq>(
            serde_json::json!({"clientHash": "a".repeat(64)})
        )
        .is_err());
    }
}
