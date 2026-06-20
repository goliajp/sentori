-- Phase 22 sub-C: Android ProGuard / R8 mapping uploads.
--
-- Mapping files are plain text but routinely 10–50 MB on big apps —
-- bytea works fine, PG TOASTs anything > ~2 KB. Same shape as the
-- dsyms table (sub-A): one row per uploaded mapping, keyed for
-- lookup by (project_id, debug_id) where debug_id is the optional
-- build identifier R8 emits in the mapping header (the "uuid"
-- comment line). Falls back to release name when the mapping
-- predates R8's identifier.

CREATE TABLE IF NOT EXISTS proguard_mappings (
    id              UUID PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release         TEXT,
    debug_id        TEXT,
    size_bytes      INTEGER NOT NULL,
    data            BYTEA NOT NULL,
    uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup index: prefer matching by debug_id when the mapping has
-- one, fall back to release.
CREATE INDEX IF NOT EXISTS proguard_mappings_debug_idx
    ON proguard_mappings (project_id, debug_id);
CREATE INDEX IF NOT EXISTS proguard_mappings_release_idx
    ON proguard_mappings (project_id, release, uploaded_at DESC);
