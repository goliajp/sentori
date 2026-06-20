-- v1.3 W15 — surface metadata about uploaded source bundles.
--
-- entry_count + uncompressed_size_bytes are populated at upload
-- time (server/src/api/source_bundle.rs) so the dashboard's
-- "Uploaded source bundles" panel can render
-- "n files · 12 MB · 5m ago" without re-extracting on every page
-- load.

ALTER TABLE release_artifacts
    ADD COLUMN IF NOT EXISTS entry_count INTEGER;

ALTER TABLE release_artifacts
    ADD COLUMN IF NOT EXISTS uncompressed_size_bytes BIGINT;
