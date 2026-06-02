-- Phase 24 sub-C: saved views.
--
-- A "view" is a saved snapshot of a filterable list — name + payload
-- (query string + status tab + column visibility). Today only the
-- issues list uses it; the `target` column is a forward-looking
-- discriminator so future tables (events tail, releases) can reuse
-- the same table without another migration.
--
-- Three scopes:
--   - personal: visible only to its creator.
--   - team:     visible to everyone in the bound team.
--   - org:      visible to every org member.
--
-- Scope ↔ FK polarity is enforced by a CHECK so we don't have to
-- relitigate the rule in app code: personal needs user_id, team needs
-- team_id, org has neither.

CREATE TABLE IF NOT EXISTS saved_views (
    id          UUID PRIMARY KEY,
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    target      TEXT NOT NULL CHECK (target IN ('issues')),
    scope       TEXT NOT NULL CHECK (scope IN ('personal', 'team', 'org')),
    team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (
        (scope = 'personal' AND user_id IS NOT NULL AND team_id IS NULL)
     OR (scope = 'team'     AND team_id IS NOT NULL AND user_id IS NULL)
     OR (scope = 'org'      AND team_id IS NULL     AND user_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS saved_views_org_target_idx
    ON saved_views (org_id, target);
CREATE INDEX IF NOT EXISTS saved_views_user_idx
    ON saved_views (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS saved_views_team_idx
    ON saved_views (team_id) WHERE team_id IS NOT NULL;
