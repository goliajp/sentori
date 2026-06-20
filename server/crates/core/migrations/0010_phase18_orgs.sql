-- Phase 18 sub-A: Org account structure deepening.
--
-- Introduces teams as a sub-grouping inside an org, project ↔ team many-to-many
-- binding, an audit_log trail for admin actions, and an ownership-transfer
-- token table so org owners can hand the org to another admin.
--
-- IDs are uuid v7 generated server-side (matches existing pattern); the DB
-- never autogenerates UUIDs. All child rows cascade on parent delete.

CREATE TABLE IF NOT EXISTS teams (
    id          UUID PRIMARY KEY,
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    slug        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug)
);
CREATE INDEX IF NOT EXISTS teams_org_idx ON teams (org_id);

CREATE TABLE IF NOT EXISTS team_memberships (
    team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('lead', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_memberships_user_idx ON team_memberships (user_id);

CREATE TABLE IF NOT EXISTS project_teams (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id    UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, team_id)
);
CREATE INDEX IF NOT EXISTS project_teams_team_idx ON project_teams (team_id);

-- Audit log: append-only record of admin-level mutating actions inside an org.
-- Backfills are not attempted; this becomes useful from the moment Phase 18
-- sub-C wires audit::record into endpoints.
CREATE TABLE IF NOT EXISTS audit_logs (
    id            UUID PRIMARY KEY,
    org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action        TEXT NOT NULL,
    target_type   TEXT NOT NULL,
    target_id     UUID,
    payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_org_created_idx
    ON audit_logs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
    ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_target_idx
    ON audit_logs (target_type, target_id);

-- Ownership transfer flow: a pending transfer holds a one-shot token that the
-- recipient must accept via a signed link. Expired or accepted rows stay for
-- audit purposes (queryable via audit_logs as well).
CREATE TABLE IF NOT EXISTS org_ownership_transfers (
    id            UUID PRIMARY KEY,
    org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token         TEXT NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    accepted_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_ownership_transfers_org_idx
    ON org_ownership_transfers (org_id, created_at DESC);
