-- Phase 18 sub-F: optional team binding on invites.
--
-- When set, accept_invite atomically inserts the new team_memberships
-- row alongside the org membership. ON DELETE SET NULL rather than
-- CASCADE because dropping a team should not invalidate pending invites
-- to the org itself.

ALTER TABLE org_invites
    ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS org_invites_team_id_idx ON org_invites (team_id);
