-- v2.4 — Operator-driven identity merge.
--
-- Recovered defer from `docs/design/sdk-v2.3-redesign.md` §8.
-- Story: the same human registers in your app via Google in
-- January then via email in March. Sentori has two distinct
-- fingerprints for them — one per identity key. When the
-- operator notices this, they invoke `merge(primary, alias)`;
-- subsequent lookups against `alias` transparently return
-- `primary`'s event set.
--
-- Schema:
--
--   identity_merges
--     scope_id     UUID  -- the boundary the merge lives in
--     primary_fp   BYTEA(32)  -- the "canonical" fingerprint
--     alias_fp     BYTEA(32)  -- the merged-into fingerprint
--     merged_by    UUID  -- operator user id (null if system)
--     merged_at    TIMESTAMPTZ
--     undone_at    TIMESTAMPTZ NULL  -- soft-undo (7-day window)
--     PK (scope_id, alias_fp)
--
-- Why `alias_fp` is the PK and not `(primary_fp, alias_fp)`: an
-- alias points at exactly one primary. Pointing the same alias
-- at two primaries would be undefined behaviour for lookups; we
-- enforce uniqueness in the schema.
--
-- Lookup follow-through: at query time, the lookup endpoint
-- checks `identity_merges` for the input fingerprint as alias;
-- if found, swaps to the primary and continues. One-hop only
-- (no chain-of-merges — flat keeps the read cost predictable).
--
-- Undo: `undone_at IS NOT NULL` excludes the row from
-- lookup-follow. Operator UI surfaces a 7-day undo window;
-- after that, the row stays for audit but the undo button
-- disappears.

CREATE TABLE IF NOT EXISTS identity_merges (
    scope_id   UUID         NOT NULL REFERENCES identity_scopes(id) ON DELETE CASCADE,
    primary_fp BYTEA        NOT NULL CHECK (octet_length(primary_fp) = 32),
    alias_fp   BYTEA        NOT NULL CHECK (octet_length(alias_fp)   = 32),
    merged_by  UUID         NULL REFERENCES users(id) ON DELETE SET NULL,
    merged_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    undone_at  TIMESTAMPTZ  NULL,
    PRIMARY KEY (scope_id, alias_fp),
    -- Tiny safety net: alias can't equal primary (no self-merge).
    CHECK (alias_fp != primary_fp)
);

-- Lookup-follow path: given an alias fingerprint, find its primary.
CREATE INDEX IF NOT EXISTS identity_merges_active_lookup_idx
    ON identity_merges (scope_id, alias_fp)
    WHERE undone_at IS NULL;

-- "Show all aliases pointing at this primary" — drives the
-- merge-history view on a fingerprint detail page.
CREATE INDEX IF NOT EXISTS identity_merges_primary_idx
    ON identity_merges (scope_id, primary_fp)
    WHERE undone_at IS NULL;
