//! v2.3 — identity-scope resolution + fingerprint computation.
//!
//! Glue between the events ingest path and the `identity_scopes` +
//! `identity_fingerprints` tables (migration 0065).
//!
//! Wire flow per event:
//!
//!   1. SDK already hashed `email/phone/...` client-side. `event.user
//!      .link_hashes` is a map of (key_type → 64-char lowercase hex
//!      sha256).
//!   2. Server validates each value matches the regex; rejects the
//!      event with 400 if not (defence against a buggy / malicious
//!      SDK sending raw values).
//!   3. Server resolves the identity scope for this event's project
//!      (v2.3: always the org's default scope). Loads + caches the
//!      32-byte salt.
//!   4. For each (key_type, client_hash), computes the stored
//!      fingerprint:
//!          stored = sha256(scope.salt || key_type || ":" || client_hash)
//!      and INSERTs into `identity_fingerprints`.
//!   5. Cross-project operator lookup uses the same hash formula —
//!      operator supplies (key_type, client_hash) → server computes
//!      the same stored hash → JOIN against identity_fingerprints
//!      WHERE scope_id matches.

use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::error::AppError;

/// 64-char lowercase hex sha256. Validate client-supplied
/// `linkHashes` values match this shape — anything else is either a
/// bug in the SDK or a malicious payload trying to slip raw PII
/// through. Reject the entire event.
pub fn is_valid_client_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// Resolve which `identity_scope_id` an event ingested for the given
/// project should hash against. v2.3 logic: project's org's default
/// scope. v2.4+ may also honour a `projects.identity_scope_id`
/// override; the schema is ready, the resolution code isn't here yet.
pub async fn resolve_scope_for_project(
    pool: &PgPool,
    project_id: Uuid,
) -> Result<Option<(Uuid, Vec<u8>)>, AppError> {
    let row: Option<(Uuid, Vec<u8>)> = sqlx::query_as(
        r#"
        SELECT s.id, s.salt
        FROM projects p
        JOIN orgs o ON o.id = p.org_id
        JOIN org_identity_scopes ois ON ois.org_id = o.id AND ois.is_default = true
        JOIN identity_scopes s ON s.id = ois.scope_id
        WHERE p.id = $1
        LIMIT 1
        "#,
    )
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(row)
}

/// Compute the stored fingerprint = sha256(salt || key_type || ":" || client_hash).
/// Returns 32 raw bytes — caller stores as `BYTEA(32)`.
pub fn compute_fingerprint(salt: &[u8], key_type: &str, client_hash: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(key_type.as_bytes());
    hasher.update(b":");
    hasher.update(client_hash.as_bytes());
    hasher.finalize().to_vec()
}

/// Persist (event_id, scope_id, key_type, fingerprint) for every
/// link_hash entry on the event. Idempotent via primary key
/// `(event_id, scope_id, key_type)`.
///
/// No-op if the event has no `link_hashes` (the common case for
/// hosts that haven't called `setUser({ linkBy })`).
pub async fn write_event_fingerprints(
    pool: &PgPool,
    event_id: Uuid,
    project_id: Uuid,
    link_hashes: &std::collections::HashMap<String, String>,
) -> Result<(), AppError> {
    if link_hashes.is_empty() {
        return Ok(());
    }
    let Some((scope_id, salt)) = resolve_scope_for_project(pool, project_id).await? else {
        // Project has no default scope — shouldn't happen post-
        // migration but don't fail the ingest.
        return Ok(());
    };
    for (key_type, client_hash) in link_hashes {
        let fp = compute_fingerprint(&salt, key_type, client_hash);
        let _ = sqlx::query(
            r#"
            INSERT INTO identity_fingerprints (event_id, scope_id, key_type, fingerprint)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (event_id, scope_id, key_type) DO NOTHING
            "#,
        )
        .bind(event_id)
        .bind(scope_id)
        .bind(key_type)
        .bind(&fp)
        .execute(pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_client_hash_accepts_64_lower_hex() {
        assert!(is_valid_client_hash(
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        ));
    }

    #[test]
    fn valid_client_hash_rejects_uppercase() {
        assert!(!is_valid_client_hash(
            "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        ));
    }

    #[test]
    fn valid_client_hash_rejects_short() {
        assert!(!is_valid_client_hash("abcd"));
    }

    #[test]
    fn valid_client_hash_rejects_raw_email() {
        assert!(!is_valid_client_hash("lihao@golia.jp"));
    }

    #[test]
    fn compute_fingerprint_stable_across_calls() {
        let salt = b"deadbeefdeadbeefdeadbeefdeadbeef";
        let h = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let a = compute_fingerprint(salt, "email", h);
        let b = compute_fingerprint(salt, "email", h);
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn compute_fingerprint_key_type_changes_output() {
        let salt = b"deadbeefdeadbeefdeadbeefdeadbeef";
        let h = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let email_fp = compute_fingerprint(salt, "email", h);
        let phone_fp = compute_fingerprint(salt, "phone", h);
        assert_ne!(email_fp, phone_fp);
    }

    #[test]
    fn compute_fingerprint_salt_changes_output() {
        let h = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
        let salt_a = b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let salt_b = b"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let fp_a = compute_fingerprint(salt_a, "email", h);
        let fp_b = compute_fingerprint(salt_b, "email", h);
        assert_ne!(fp_a, fp_b);
    }
}
