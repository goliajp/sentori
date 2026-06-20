-- v2.25 — push_sends gains optional campaign / template / audience
-- tags. Write-only in v2.25; surfaces in v2.27's push-correlation BI
-- where the dashboard slices "this campaign's downstream impact".
--
-- All three are nullable + free-text. Sentori does not impose a
-- taxonomy; callers tag the way they already tag their analytics
-- events. Index supports the typical BI query
-- "WHERE project = ? AND campaign = ? ORDER BY sent DESC".

ALTER TABLE push_sends
    ADD COLUMN campaign_id   TEXT,
    ADD COLUMN template_id   TEXT,
    ADD COLUMN audience_tag  TEXT;

CREATE INDEX push_sends_campaign_idx
    ON push_sends (project_id, campaign_id, created_at DESC)
    WHERE campaign_id IS NOT NULL;
