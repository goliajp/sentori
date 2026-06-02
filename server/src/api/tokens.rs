// Phase 14 sub-section A: token CRUD for the dashboard.
//
// Token format: `st_pk_` + 26 chars of Crockford base32 (lowercase).
// We hash with sha256 (matches `auth::hash_token`) and store only the hash
// + the last 4 chars for visual identification. The raw token is returned
// once on creation; later listings only show metadata.

use axum::{
    extract::{Extension, Json, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::api::admin_auth::AdminCaller;
use crate::auth::hash_token;
use crate::recent::AppState;

const LABEL_MAX: usize = 64;

#[derive(Deserialize)]
pub struct CreateTokenBody {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "public".to_string()
}

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TokenRow {
    pub id: Uuid,
    pub kind: String,
    pub label: Option<String>,
    pub last4: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub revoked_at: Option<OffsetDateTime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenCreated {
    pub id: Uuid,
    pub kind: String,
    pub label: Option<String>,
    /// The raw token, returned exactly once. Clients must store it now
    /// — the server only retains the sha256 hash and the last 4 chars.
    pub token: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub async fn list_tokens(
    State(state): State<AppState>,
    Path(project_id): Path<Uuid>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => return server_error("dbNotConfigured"),
    };
    let rows: Vec<TokenRow> = sqlx::query_as(
        "SELECT id, kind, label, last4, created_at, revoked_at \
         FROM tokens WHERE project_id = $1 \
         ORDER BY created_at DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    (StatusCode::OK, Json(rows)).into_response()
}

pub async fn create_token(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<CreateTokenBody>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p.clone(),
        None => return server_error("dbNotConfigured"),
    };

    // Token kind: only 'public' or 'admin' allowed.
    if !matches!(body.kind.as_str(), "public" | "admin") {
        return bad_request("invalidKind");
    }
    let label = body
        .label
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(LABEL_MAX).collect::<String>());

    // For User callers, ensure they're owner or admin of the project's org.
    // Super-admins (LegacyAdmin / DevToken) skip the role check.
    if let AdminCaller::User { id, .. } = &caller {
        let role: Option<String> = sqlx::query_scalar(
            "SELECT m.role FROM projects p \
             JOIN memberships m ON m.org_id = p.org_id \
             WHERE p.id = $1 AND m.user_id = $2",
        )
        .bind(project_id)
        .bind(id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();
        if !matches!(role.as_deref(), Some("owner") | Some("admin")) {
            return forbidden("forbidden");
        }
    }

    // Resolve org_id from project for the FK insert.
    let org_id: Option<Uuid> =
        sqlx::query_scalar("SELECT org_id FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();
    let org_id = match org_id {
        Some(o) => o,
        None => return not_found("projectNotFound"),
    };

    let token_id = Uuid::now_v7();
    let raw = generate_public_token();
    let last4 = raw.chars().rev().take(4).collect::<String>().chars().rev().collect::<String>();
    let token_hash = hash_token(&raw);

    let result = sqlx::query(
        "INSERT INTO tokens (id, project_id, org_id, token_hash, kind, label, last4) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(token_id)
    .bind(project_id)
    .bind(org_id)
    .bind(&token_hash)
    .bind(&body.kind)
    .bind(label.as_deref())
    .bind(&last4)
    .execute(&pool)
    .await;
    if let Err(e) = result {
        tracing::error!(error = %e, "insert token failed");
        return server_error("insertToken");
    }

    let created_at: OffsetDateTime = sqlx::query_scalar(
        "SELECT created_at FROM tokens WHERE id = $1",
    )
    .bind(token_id)
    .fetch_one(&pool)
    .await
    .unwrap_or_else(|_| OffsetDateTime::now_utc());

    let actor = match &caller {
        AdminCaller::User { id, .. } => Some(*id),
        _ => None,
    };
    crate::audit::record(
        &pool,
        org_id,
        actor,
        crate::audit::actions::TOKEN_CREATED,
        crate::audit::targets::TOKEN,
        Some(token_id),
        json!({ "project_id": project_id, "kind": body.kind, "last4": last4 }),
    )
    .await;

    (
        StatusCode::CREATED,
        Json(TokenCreated {
            id: token_id,
            kind: body.kind,
            label,
            token: raw,
            created_at,
        }),
    )
        .into_response()
}

pub async fn revoke_token(
    State(state): State<AppState>,
    Extension(caller): Extension<AdminCaller>,
    Path((project_id, token_id)): Path<(Uuid, Uuid)>,
) -> Response {
    let pool = match &state.db {
        Some(p) => p,
        None => return server_error("dbNotConfigured"),
    };

    if let AdminCaller::User { id, .. } = &caller {
        let role: Option<String> = sqlx::query_scalar(
            "SELECT m.role FROM projects p \
             JOIN memberships m ON m.org_id = p.org_id \
             WHERE p.id = $1 AND m.user_id = $2",
        )
        .bind(project_id)
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        if !matches!(role.as_deref(), Some("owner") | Some("admin")) {
            return forbidden("forbidden");
        }
    }

    let result = sqlx::query(
        "UPDATE tokens SET revoked_at = now() \
         WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL",
    )
    .bind(token_id)
    .bind(project_id)
    .execute(pool)
    .await;

    if let Ok(r) = &result
        && r.rows_affected() > 0
    {
        let org_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT org_id FROM projects WHERE id = $1",
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
        let actor = match &caller {
            AdminCaller::User { id, .. } => Some(*id),
            _ => None,
        };
        if let Some(oid) = org_id {
            crate::audit::record(
                pool,
                oid,
                actor,
                crate::audit::actions::TOKEN_REVOKED,
                crate::audit::targets::TOKEN,
                Some(token_id),
                json!({ "project_id": project_id }),
            )
            .await;
        }
    }

    match result {
        Ok(r) if r.rows_affected() == 0 => not_found("tokenNotFound"),
        Ok(_) => (StatusCode::OK, Json(json!({ "ok": true }))).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "revoke token failed");
            server_error("revokeToken")
        }
    }
}

/// `st_pk_` + 26 lowercase Crockford base32 chars. Encodes 16 random bytes
/// (128 bits of entropy — same shape as a uuid v7's bit budget).
fn generate_public_token() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!("st_pk_{}", crockford_encode_lower(&bytes))
}

const CROCKFORD: &[u8] = b"0123456789abcdefghjkmnpqrstvwxyz";

fn crockford_encode_lower(bytes: &[u8]) -> String {
    let mut bits: u64 = 0;
    let mut nbits: u32 = 0;
    let mut out = String::new();
    for &b in bytes {
        bits = (bits << 8) | b as u64;
        nbits += 8;
        while nbits >= 5 {
            let idx = ((bits >> (nbits - 5)) & 0x1f) as usize;
            out.push(CROCKFORD[idx] as char);
            nbits -= 5;
        }
    }
    if nbits > 0 {
        let idx = ((bits << (5 - nbits)) & 0x1f) as usize;
        out.push(CROCKFORD[idx] as char);
    }
    out
}

fn bad_request(error: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response()
}
fn forbidden(error: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": error }))).into_response()
}
fn not_found(error: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": error }))).into_response()
}
fn server_error(error: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": error })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_format() {
        let t = generate_public_token();
        assert!(t.starts_with("st_pk_"));
        let body = &t[6..];
        assert_eq!(body.len(), 26);
        for c in body.chars() {
            assert!(CROCKFORD.contains(&(c as u8)), "non-crockford char: {c}");
        }
    }

    #[test]
    fn crockford_known_vector() {
        // "Hello" = 0x48656c6c6f. Crockford lowercase = "91jprv3f".
        assert_eq!(crockford_encode_lower(b"Hello"), "91jprv3f");
    }
}
