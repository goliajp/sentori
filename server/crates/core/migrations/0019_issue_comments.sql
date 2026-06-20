-- Phase 25 sub-E: per-issue comment thread.
--
-- Comments are independent of audit_logs — keeps the audit trail
-- focused on security-relevant mutations and lets the comment table
-- evolve (edits, threading, mentions) without polluting audit's
-- append-only contract.
--
-- Edits are not implemented in v0.2; we keep the column shape ready
-- (no `updated_at`) — when sub-F adds edit support, an UPDATE column
-- will land in a follow-up migration.

CREATE TABLE IF NOT EXISTS issue_comments (
    id         UUID PRIMARY KEY,
    issue_id   UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_comments_issue_idx
    ON issue_comments (issue_id, created_at);
