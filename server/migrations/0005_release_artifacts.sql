-- Phase 8 sub-section B: release artifacts (sourcemaps now; dSYM /
-- ProGuard mappings later in v0.2).

CREATE TABLE IF NOT EXISTS release_artifacts (
    id            UUID PRIMARY KEY,
    release_id    UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,           -- 'sourcemap' | 'js' | 'dsym' | 'proguard'
    name          TEXT NOT NULL,           -- original filename, e.g. "app.bundle.js.map"
    content_hash  TEXT NOT NULL,           -- sha256 hex
    blob_path     TEXT NOT NULL,           -- on-disk path under SENTORI_DATA_DIR/artifacts/
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (release_id, name)
);

CREATE INDEX IF NOT EXISTS release_artifacts_release_id_idx
    ON release_artifacts (release_id);
CREATE INDEX IF NOT EXISTS release_artifacts_kind_idx
    ON release_artifacts (release_id, kind);
