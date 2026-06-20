//! v2.4 — operator-driven identity merge.
//!
//!   POST /admin/api/orgs/{slug}/users/merge
//!   body: {
//!     primary: { keyType, clientHash },
//!     alias:   { keyType, clientHash }
//!   }
//!
//!   POST /admin/api/orgs/{slug}/users/merge/undo
//!   body: { alias: { keyType, clientHash } }
//!
//! Story: the same human registers in your app via Google in
//! January then via email in March. Sentori's two fingerprints
//! for them are correct — they're computed off two different
//! `linkBy` keys — but operationally the operator wants them
//! collapsed. The merge writes one row in `identity_merges`
//! mapping alias → primary. Subsequent
//! `/admin/api/orgs/{slug}/users/lookup` calls against the alias
//! transparently return the primary's events (one-hop follow,
//! see `identity_lookup.rs`).
//!
//! Undo: soft (sets `undone_at`); 7-day window enforced in the
//! dashboard, not server-side, because audit value of the row
//! survives forever even when its lookup-effect is reversed.
//!
//! Audit:
//!   - Action codes `identity.merged` / `identity.merge_undone`.
//!   - target_type `identity_scope`, target_id the scope UUID.
//!   - payload echoes `primaryPrefix` + `aliasPrefix` (8-hex each).
//!     Raw values + full hashes never logged.

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
pub struct IdentityRef {
    pub key_type: String,
    pub client_hash: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReq {
    pub primary: IdentityRef,
    pub alias: IdentityRef,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoReq {
    pub alias: IdentityRef,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResp {
    pub scope_id: Uuid,
    pub primary_prefix: String,
    pub alias_prefix: String,
    /// `true` if the row was newly created; `false` if an
    /// identical merge already existed and we just refreshed
    /// `undone_at = NULL`.
    pub created: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResp {
    pub scope_id: Uuid,
    pub alias_prefix: String,
    pub undone: bool,
}

pub async fn merge(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(org_slug): Path<String>,
    Json(req): Json<MergeReq>,
) -> Result<Json<MergeResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let actor_user_id = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };

    validate(&req.primary)?;
    validate(&req.alias)?;
    if req.primary.key_type == req.alias.key_type && req.primary.client_hash == req.alias.client_hash
    {
        return Err(AppError::BadRequest(
            "primary and alias must differ".into(),
        ));
    }

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
        return Err(AppError::BadRequest("org not found".into()));
    };

    let primary_fp =
        crate::identity::compute_fingerprint(&salt, &req.primary.key_type, &req.primary.client_hash);
    let alias_fp =
        crate::identity::compute_fingerprint(&salt, &req.alias.key_type, &req.alias.client_hash);

    if primary_fp == alias_fp {
        return Err(AppError::BadRequest(
            "primary and alias hash to the same scope fingerprint — nothing to merge".into(),
        ));
    }

    // INSERT … ON CONFLICT DO UPDATE so a re-merge of the same
    // (scope, alias) refreshes `undone_at = NULL` (re-activating
    // a previously-undone merge) and re-points `primary_fp` if
    // the operator changed their mind about who's canonical.
    let result = sqlx::query_scalar::<_, bool>(
        r#"
        INSERT INTO identity_merges (scope_id, primary_fp, alias_fp, merged_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (scope_id, alias_fp) DO UPDATE
          SET primary_fp = EXCLUDED.primary_fp,
              merged_by  = EXCLUDED.merged_by,
              merged_at  = now(),
              undone_at  = NULL
        RETURNING (xmax = 0) AS created
        "#,
    )
    .bind(scope_id)
    .bind(&primary_fp)
    .bind(&alias_fp)
    .bind(actor_user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let primary_prefix = hex_prefix(&primary_fp);
    let alias_prefix = hex_prefix(&alias_fp);
    audit::record(
        pool,
        org_id,
        actor_user_id,
        audit::actions::IDENTITY_MERGED,
        audit::targets::IDENTITY_SCOPE,
        Some(scope_id),
        serde_json::json!({
            "primaryPrefix": primary_prefix,
            "aliasPrefix": alias_prefix,
            "created": result,
        }),
    )
    .await;

    Ok(Json(MergeResp {
        scope_id,
        primary_prefix,
        alias_prefix,
        created: result,
    }))
}

pub async fn undo_merge(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(org_slug): Path<String>,
    Json(req): Json<UndoReq>,
) -> Result<Json<UndoResp>, AppError> {
    let pool = state.db.as_ref().ok_or(AppError::DatabaseUnavailable)?;
    let actor_user_id = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };

    validate(&req.alias)?;

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
        return Err(AppError::BadRequest("org not found".into()));
    };

    let alias_fp =
        crate::identity::compute_fingerprint(&salt, &req.alias.key_type, &req.alias.client_hash);

    let n: u64 = sqlx::query(
        "UPDATE identity_merges SET undone_at = now() \
         WHERE scope_id = $1 AND alias_fp = $2 AND undone_at IS NULL",
    )
    .bind(scope_id)
    .bind(&alias_fp)
    .execute(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
    .rows_affected();

    let undone = n > 0;
    let alias_prefix = hex_prefix(&alias_fp);
    if undone {
        audit::record(
            pool,
            org_id,
            actor_user_id,
            audit::actions::IDENTITY_MERGE_UNDONE,
            audit::targets::IDENTITY_SCOPE,
            Some(scope_id),
            serde_json::json!({ "aliasPrefix": alias_prefix }),
        )
        .await;
    }

    Ok(Json(UndoResp {
        scope_id,
        alias_prefix,
        undone,
    }))
}

fn validate(ident: &IdentityRef) -> Result<(), AppError> {
    if !crate::identity::is_valid_client_hash(&ident.client_hash) {
        return Err(AppError::BadRequest(
            "clientHash must be 64-char lowercase hex sha256".into(),
        ));
    }
    if ident.key_type.is_empty() || ident.key_type.len() > 64 {
        return Err(AppError::BadRequest(
            "keyType must be non-empty and <= 64 chars".into(),
        ));
    }
    Ok(())
}

fn hex_prefix(fp: &[u8]) -> String {
    fp.iter().take(4).map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_req_parses() {
        let body = serde_json::json!({
            "primary": { "keyType": "email", "clientHash": "a".repeat(64) },
            "alias":   { "keyType": "googleSub", "clientHash": "b".repeat(64) },
        });
        let req: MergeReq = serde_json::from_value(body).expect("parses");
        assert_eq!(req.primary.key_type, "email");
        assert_eq!(req.alias.key_type, "googleSub");
    }

    #[test]
    fn undo_req_parses() {
        let body = serde_json::json!({
            "alias": { "keyType": "email", "clientHash": "a".repeat(64) },
        });
        let req: UndoReq = serde_json::from_value(body).expect("parses");
        assert_eq!(req.alias.key_type, "email");
    }
}
