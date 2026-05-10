-- Phase 19 sub-A: introduce the `viewer` role.
--
-- Org viewers can read everything an org member can but cannot mutate
-- (no token create / revoke, no resolve issue, no invite, no team
-- changes). Team viewers are the same scoped to a team — useful for
-- read-only auditors.
--
-- billing_admin is intentionally NOT added here: it has no enforcement
-- target until Phase 27's alerting/billing work. Adding it now would
-- create a role with no semantics, which is worse than waiting.

ALTER TABLE memberships
    DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships
    ADD CONSTRAINT memberships_role_check
    CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text]));

ALTER TABLE team_memberships
    DROP CONSTRAINT IF EXISTS team_memberships_role_check;
ALTER TABLE team_memberships
    ADD CONSTRAINT team_memberships_role_check
    CHECK (role = ANY (ARRAY['lead'::text, 'member'::text, 'viewer'::text]));

ALTER TABLE org_invites
    DROP CONSTRAINT IF EXISTS org_invites_role_check;
ALTER TABLE org_invites
    ADD CONSTRAINT org_invites_role_check
    CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text]));
