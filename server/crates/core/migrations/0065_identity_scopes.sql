-- v2.3 W6.a — Identity Scope abstraction for cross-project user
-- correlation.
--
-- The model:
--
--   identity_scope = an opaque "salt + name" boundary. All events
--                    ingested under a given scope hash their user
--                    identities (email / phone / oauth_sub / etc.)
--                    against the same salt → cross-project join key.
--                    Events across different scopes don't correlate
--                    (different salts → different stored hashes for
--                    the same identity value).
--
-- Why this isn't just "org-scoped":
--
--   Org is overloaded — it owns billing, permissions, DNS slug,
--   project membership, team membership. Identity correlation is a
--   strictly separate concern: an org might want consumer-app users
--   tracked SEPARATELY from b2b-app users even though both projects
--   share the org (different audiences, different privacy
--   policies). Decoupling the boundary lets later admin ops move
--   projects between scopes without dragging tenant semantics.
--
-- v2.3 scope-binding policy (deliberately minimal):
--
--   - Each existing org gets one auto-created "default" identity
--     scope (named after the org slug).
--   - Every event that an org's project ingests hashes against that
--     org's default scope salt.
--   - There is NO per-project scope binding column in this
--     migration. v2.3 hard-codes "use the org's default scope".
--     Future (v2.4+) can add an optional projects.identity_scope_id
--     for carved sub-scopes; the architecture supports it but no
--     concrete use case demands it yet.
--   - Apps that want zero identity tracking simply don't call
--     `setUser({ identities: ... })`. Events without identity keys
--     never get a stored hash; nothing to join on.
--
-- The salt is BYTEA(32). Postgres-level disk encryption is the
-- intended at-rest protection; KMS / per-row-encryption is
-- out-of-scope for this migration.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS identity_scopes (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT         NOT NULL,
    -- 32 random bytes. Loaded into server memory on cache miss;
    -- never sent over the wire, never displayed to operators.
    salt        BYTEA        NOT NULL CHECK (octet_length(salt) = 32),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Each org has exactly one default identity_scope. The
-- `org_identity_scopes` table will later carry many-to-many for
-- carved sub-scopes; for v2.3 it's strictly 1:1 via the partial
-- unique index below.
CREATE TABLE IF NOT EXISTS org_identity_scopes (
    org_id     UUID     NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    scope_id   UUID     NOT NULL REFERENCES identity_scopes(id) ON DELETE RESTRICT,
    is_default BOOLEAN  NOT NULL DEFAULT false,
    PRIMARY KEY (org_id, scope_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_identity_scopes_default_idx
    ON org_identity_scopes (org_id)
    WHERE is_default = true;

-- Backfill: every existing org gets one default scope named after
-- its slug. New orgs created post-migration auto-create their
-- default scope via the application's org-create path (W6.b).
WITH new_scopes AS (
    INSERT INTO identity_scopes (id, name, salt)
    SELECT
        gen_random_uuid(),
        o.slug || ' (auto)',
        gen_random_bytes(32)
    FROM orgs o
    WHERE NOT EXISTS (
        SELECT 1 FROM org_identity_scopes ois WHERE ois.org_id = o.id
    )
    RETURNING id, name
)
INSERT INTO org_identity_scopes (org_id, scope_id, is_default)
SELECT
    o.id,
    s.id,
    true
FROM orgs o
JOIN new_scopes s ON s.name = o.slug || ' (auto)';
