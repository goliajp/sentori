// Phase 18 sub-C: append-only audit trail of admin-level mutating
// actions inside an org. Endpoints call `audit::record` after a
// successful write; failures here log but never abort the caller's
// flow (audit gaps are acceptable, double-write is not).
//
// Action and target_type strings stay short and stable — Phase 20
// will turn them into a real enum + i18n keys, but at that point we
// don't want to rewrite history. Keep them snake_case.

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

pub mod actions {
    pub const ORG_CREATED: &str = "org.created";
    pub const ORG_PATCHED: &str = "org.patched";
    pub const ORG_DELETED: &str = "org.deleted";
    pub const ORG_TRANSFER_REQUESTED: &str = "org.transfer.requested";
    pub const ORG_TRANSFER_ACCEPTED: &str = "org.transfer.accepted";

    pub const MEMBER_ROLE_PATCHED: &str = "member.role_patched";
    pub const MEMBER_REMOVED: &str = "member.removed";

    pub const TEAM_CREATED: &str = "team.created";
    pub const TEAM_PATCHED: &str = "team.patched";
    pub const TEAM_DELETED: &str = "team.deleted";
    pub const TEAM_MEMBER_ADDED: &str = "team.member.added";
    pub const TEAM_MEMBER_PATCHED: &str = "team.member.patched";
    pub const TEAM_MEMBER_REMOVED: &str = "team.member.removed";

    pub const PROJECT_CREATED: &str = "project.created";
    pub const PROJECT_TEAM_BOUND: &str = "project.team.bound";
    pub const PROJECT_TEAM_UNBOUND: &str = "project.team.unbound";

    pub const TOKEN_CREATED: &str = "token.created";
    pub const TOKEN_REVOKED: &str = "token.revoked";
}

pub mod targets {
    pub const ORG: &str = "org";
    pub const MEMBER: &str = "member";
    pub const TEAM: &str = "team";
    pub const TEAM_MEMBER: &str = "team_member";
    pub const PROJECT: &str = "project";
    pub const PROJECT_TEAM: &str = "project_team";
    pub const TOKEN: &str = "token";
    pub const TRANSFER: &str = "transfer";
}

/// Persist one audit row. Returns Ok even on DB error — the caller's
/// path has already succeeded by the time this runs and we never want
/// audit-write failure to mask a successful business action.
pub async fn record(
    pool: &PgPool,
    org_id: Uuid,
    actor_user_id: Option<Uuid>,
    action: &str,
    target_type: &str,
    target_id: Option<Uuid>,
    payload: impl Serialize,
) {
    let payload = match serde_json::to_value(&payload) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, action, "audit payload serialize failed");
            serde_json::Value::Null
        }
    };
    let id = Uuid::now_v7();
    if let Err(e) = sqlx::query(
        "INSERT INTO audit_logs \
            (id, org_id, actor_user_id, action, target_type, target_id, payload) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(org_id)
    .bind(actor_user_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(&payload)
    .execute(pool)
    .await
    {
        tracing::warn!(
            error = %e, action, target_type, ?target_id,
            "audit_logs insert failed"
        );
    }
}
