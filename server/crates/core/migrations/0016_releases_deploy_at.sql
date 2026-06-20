-- Phase 23 sub-A: track when a release was deployed.
--
-- `created_at` is the first time *any* artifact for the release
-- touched the server (event ingest or dSYM/sourcemap upload, whichever
-- came first). `deploy_at` is when the build was actually rolled out
-- to users — supplied either explicitly via Phase 23 sub-C's
-- `POST /v1/deploys` webhook, or inferred lazily from the first event
-- carrying that release name.
--
-- Counts (artifacts, events) are NOT denormalised here — they're
-- cheap aggregates the list endpoint runs at read time. We can move
-- them to summary columns later if the row count makes the COUNT()s
-- slow, but for v0.2 expected scale (≤ 1k releases per project) the
-- live JOIN is fine.

ALTER TABLE releases
    ADD COLUMN IF NOT EXISTS deploy_at TIMESTAMPTZ;

-- Backfill: existing rows had no deploy info, so we treat the row's
-- own creation as the deploy moment. New rows get NULL until a
-- deploy hook arrives or the first event lands.
UPDATE releases SET deploy_at = created_at WHERE deploy_at IS NULL;

CREATE INDEX IF NOT EXISTS releases_project_deploy_idx
    ON releases (project_id, deploy_at DESC);
