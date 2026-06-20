-- Phase 25 sub-F: issue assignee.
--
-- One assignee per issue. ON DELETE SET NULL so removing a user from
-- the org doesn't orphan the issue — the row keeps its history of
-- having been assigned (visible via audit / activity), but the live
-- pointer goes empty.
--
-- The partial index speeds up "issues assigned to me" filters; full-
-- table scans are fine for the 99% of rows that are unassigned.

ALTER TABLE issues ADD COLUMN IF NOT EXISTS assignee_user_id UUID
    REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS issues_assignee_idx
    ON issues (assignee_user_id)
    WHERE assignee_user_id IS NOT NULL;
