-- v2.34 — push preference center. Per-(project, user, category)
-- opt-out flag. dispatch-time the enqueue path checks here and
-- silently skips when opted_out=true.
--
-- `category` is free-text: caller defines the taxonomy
-- ("marketing", "billing", "social"). Sends WITHOUT a category set
-- bypass the check (no row to match).

CREATE TABLE push_preferences (
    project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_fingerprint_hex  BYTEA NOT NULL,
    category              TEXT NOT NULL,
    opted_out             BOOLEAN NOT NULL DEFAULT false,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_fingerprint_hex, category)
);

-- The hot lookup at dispatch time is by all three PK cols, served
-- directly by the PK index.
