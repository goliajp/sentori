-- Phase 22 sub-A: iOS dSYM uploads.
--
-- One row per Mach-O slice (a single .dSYM bundle's
-- Contents/Resources/DWARF/<name> file is parsed by the CLI client to
-- extract per-arch UUID + arch; each (uuid, arch) pair is stored
-- separately so a later atos lookup keys directly on the
-- LC_UUID load command from the crashed binary).
--
-- We store the full DWARF blob as bytea. Realistic dSYMs run
-- 5–50 MB per slice; PG's TOAST handles that without trouble. Phase 22
-- sub-B's symbolicator reads the bytea, drops it into a tmpfile, and
-- shells out to `atos`.
--
-- `release` is a free text label for now (matches the wire-format
-- `release` string apps send with events). Phase 23 introduces a
-- proper `releases` table; this column survives that — we'll keep
-- the text mirror alongside `release_id` for cheap lookup.

CREATE TABLE IF NOT EXISTS dsyms (
    id              UUID PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release         TEXT,
    debug_id        TEXT NOT NULL,
    arch            TEXT NOT NULL,
    object_name     TEXT,
    size_bytes      INTEGER NOT NULL,
    data            BYTEA NOT NULL,
    uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- atos lookup keys on the (debug_id, arch) tuple from the crash event.
-- Including project_id keeps the index slim on shared dashboards where
-- multiple apps could collide on debug_id.
CREATE UNIQUE INDEX IF NOT EXISTS dsyms_lookup_idx
    ON dsyms (project_id, debug_id, arch);

-- Listing for the dashboard release detail page.
CREATE INDEX IF NOT EXISTS dsyms_project_release_idx
    ON dsyms (project_id, release, uploaded_at DESC);
