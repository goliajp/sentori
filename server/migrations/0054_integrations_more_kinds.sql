-- v1.2 W7.b/c/d — extend the integrations.kind enum to include the
-- new platforms.

ALTER TABLE integrations
    DROP CONSTRAINT IF EXISTS integrations_kind_check;

ALTER TABLE integrations
    ADD CONSTRAINT integrations_kind_check
    CHECK (kind IN ('linear', 'slack', 'github', 'gitlab', 'jira'));
