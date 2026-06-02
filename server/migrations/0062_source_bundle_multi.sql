-- v1.4 W26 — multi-bundle per (release, platform).
--
-- v1.3 W15 stored one source bundle per platform per release: the
-- INSERT upserted on (release_id, name='source-bundle-<platform>')
-- so re-uploads replaced. That doesn't fit polyrepo apps where the
-- iOS code lives in one source tree and the watchOS extension lives
-- in another — each needs its own bundle.
--
-- v1.4 W26 lets operators upload multiple bundles per (release,
-- platform), each tagged with an optional "module label" (e.g.
-- "main", "watch-ext", "share-ext"). The lookup path tries all
-- bundles for the (release, platform) until one resolves.
--
-- Schema change: the existing UNIQUE (release_id, name) constraint
-- on release_artifacts already accommodates multi by varying name.
-- v1.3 used a fixed name `source-bundle-<platform>`; W26 uses
-- `source-bundle-<platform>-<module>` so multiple coexist.
-- No schema migration needed — only a new module_label column for
-- the dashboard panel to render the operator's tag.

ALTER TABLE release_artifacts
    ADD COLUMN IF NOT EXISTS module_label TEXT;
