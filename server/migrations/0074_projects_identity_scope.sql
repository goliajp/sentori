-- v2.5+ — project-level identity scope carve.
--
-- 0065 migration deliberately scoped the v2.3 ship to "one
-- identity scope per org" — the column `projects.identity_scope_id`
-- never made it in. This migration adds it as a NULL-able
-- override: when set, the ingest path hashes the event's
-- `link_hashes` against the carved scope's salt; when NULL (the
-- default), ingest falls back to the org's default scope
-- (existing behaviour).
--
-- Use case: a single org runs both a consumer mobile app and an
-- internal admin tool. They share the same Sentori org for
-- billing, but the consumer app's identified users (email /
-- phone) should NOT be cross-correlatable with internal
-- employee logins (employeeId / username). Pointing the admin
-- project at a separate `identity_scope_id` gives them two
-- isolated salt boundaries inside one org without spinning up
-- a second org.
--
-- ON DELETE SET NULL: dropping an identity_scope (operator
-- explicitly cleans it up) silently reverts affected projects
-- to the org default, which is a sane fallback. Refusing the
-- delete (ON DELETE RESTRICT) would be safer for audit but
-- friendlier to operate; the org-default path is the long-term
-- correct behaviour for an unattended project anyway.
--
-- No backfill: existing projects keep `identity_scope_id = NULL`
-- and continue to use the org default. Switching is opt-in
-- per-project via the admin PATCH endpoint.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS identity_scope_id UUID
        REFERENCES identity_scopes(id)
        ON DELETE SET NULL;

-- Lookup-side: ingest path SELECTs the project's scope on every
-- event; index makes it a no-op when the column is null.
CREATE INDEX IF NOT EXISTS projects_identity_scope_idx
    ON projects (identity_scope_id)
    WHERE identity_scope_id IS NOT NULL;
