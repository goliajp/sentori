-- v1.2 W7.a — denormalised external metadata on issue_integration_links.
--
-- The Linear / GitHub / GitLab / Jira inbound webhook receivers
-- (W7.a..d) refresh these on each event. Dashboard reads them so the
-- "Linked issues" panel can render "ENG-123 · In Progress · Updated 5m
-- ago" without hitting the external API per page-load.
--
-- All three columns are nullable: not every adapter supplies a
-- title/status, and a fresh link from an outbound creation hasn't yet
-- received its first inbound webhook update. NULL = "not yet known".

ALTER TABLE issue_integration_links
    ADD COLUMN IF NOT EXISTS external_title TEXT;

ALTER TABLE issue_integration_links
    ADD COLUMN IF NOT EXISTS external_status TEXT;

ALTER TABLE issue_integration_links
    ADD COLUMN IF NOT EXISTS external_updated_at TIMESTAMPTZ;
