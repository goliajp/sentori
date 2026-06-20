-- v1.2 W6 — add `muted` to issue status.
--
-- Current status enum (set in 0017_issue_regression):
--   active | silenced | closed | resolved | regressed
--
-- `silenced` already means "operator dismissed this, hide from default
-- queue, no alerts." But that conflates two distinct triage gestures:
--   (a) "I'm working on it, please stop paging me on every new event
--       but keep it visible in my active queue" — soft mute.
--   (b) "Noise. Hide it from the queue entirely until I unsuppress" —
--       full silence.
--
-- v1.2 makes (a) explicit via the new `muted` status. The default
-- dashboard "active" tab includes muted (operator still triages it);
-- the existing `silenced` tab is unchanged (hidden by default).
--
-- Ingest path: like silenced/closed/regressed, muted does NOT
-- auto-regress on a new event. Only `resolved` → `regressed` flips
-- in the upsert SQL; the constraint extension here is sufficient.

ALTER TABLE issues
    DROP CONSTRAINT IF EXISTS issues_status_check;

ALTER TABLE issues
    ADD CONSTRAINT issues_status_check
    CHECK (status IN ('active', 'silenced', 'closed', 'resolved', 'regressed', 'muted'));
