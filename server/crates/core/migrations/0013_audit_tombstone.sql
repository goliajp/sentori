-- Phase 20 sub-A: keep audit log entries when an org is deleted.
--
-- The Phase 18 schema cascaded audit_logs with the parent org so that
-- deleting an org wiped its history. Tombstones are more useful: a
-- terminated org's audit trail is exactly the kind of data
-- compliance / forensics ask for.
--
-- We keep audit_logs.id, action, target_type, target_id, payload, and
-- created_at intact, drop the FK→orgs cascade, allow org_id to be NULL,
-- and recreate the FK with ON DELETE SET NULL so future deletes
-- preserve the row but null the parent reference. The index on
-- (org_id, created_at DESC) keeps working — NULL values cluster and
-- live queries always pass an org_id, so the planner ignores the NULL
-- bucket.

ALTER TABLE audit_logs
    DROP CONSTRAINT IF EXISTS audit_logs_org_id_fkey;

ALTER TABLE audit_logs
    ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_org_id_fkey
        FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;

-- Capture the org's slug + name in the row's payload at write time so
-- post-delete viewers still see *which* org the action belonged to.
-- We don't introduce a denormalised column — the payload is already
-- jsonb and Phase 18 audit::record stamps arbitrary context.
