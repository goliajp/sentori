-- v1.2 W4 — issue triage primitives: priority + labels.
--
-- The status enum (active/silenced/resolved/regressed) carries
-- lifecycle, not severity. Operators triaging a fresh queue need a
-- second axis ("which of these p0/p1/p2 issues do I work first")
-- and a third axis ("anything tagged frontend / login / payment").
-- Bolting these on as columns rather than a custom-field engine is
-- a deliberate v1.2 choice: error tracking does not need Jira's
-- per-project custom-field UI.
--
-- Priority: 4-bucket scheme matching the tasks repo + standard ops
-- vocabulary. Default `p3` so new issues land at the bottom of any
-- "what's hot" filter — they have to be explicitly promoted.
--
-- Labels: free-form text[] (no separate label-catalog table for
-- v1.2; operators type whatever they want, dedup by exact string).
-- The list-issues query gets a `labels && ARRAY[...]` matcher so
-- filter UX works without a join.

ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'p3'
        CHECK (priority IN ('p0', 'p1', 'p2', 'p3'));

ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Hot filter: "show me only p0/p1 issues" sweeps most of the
-- triage queue. GIN-on-text would be overkill; a partial b-tree on
-- (project_id, priority) is enough — most projects have << 10k
-- issues so even a full scan would be fast.
CREATE INDEX IF NOT EXISTS issues_project_priority_idx
    ON issues (project_id, priority);

-- Labels filter: a GIN on text[] is the standard pattern. Small
-- compared to the rest of the issues table.
CREATE INDEX IF NOT EXISTS issues_labels_gin_idx
    ON issues USING GIN (labels);
