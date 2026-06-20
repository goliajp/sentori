-- Phase 13 sub-section A: multi-tenant data model (users / orgs / memberships).
-- Existing single-tenant rows (projects, tokens) are backfilled into a
-- non-loginable "dev" system org so the column can become NOT NULL in one go.
-- Stable IDs (uuidv7-shaped) are reused by the server's `dev` defaults:
--   dev system user : 019508a0-0002-7000-8000-000000000000
--   dev system org  : 019508a0-0001-7000-8000-000000000000
--   dev project     : 019508a0-0000-7000-8000-000000000000  (already used)

CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orgs (
    id          UUID PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    owner_id    UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orgs_owner_id_idx ON orgs (owner_id);

CREATE TABLE IF NOT EXISTS memberships (
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships (user_id);

-- Seed the dev system user + org so existing rows have a parent.
-- The placeholder password_hash is intentionally not a valid argon2 string,
-- so login attempts against dev@local are guaranteed to fail at verify time.
INSERT INTO users (id, email, password_hash, email_verified)
VALUES (
    '019508a0-0002-7000-8000-000000000000',
    'dev@local',
    '!locked-system-account!',
    TRUE
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orgs (id, slug, name, owner_id)
VALUES (
    '019508a0-0001-7000-8000-000000000000',
    'dev',
    'Dev Org',
    '019508a0-0002-7000-8000-000000000000'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (org_id, user_id, role)
VALUES (
    '019508a0-0001-7000-8000-000000000000',
    '019508a0-0002-7000-8000-000000000000',
    'owner'
)
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Backfill projects.org_id then enforce NOT NULL.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);
UPDATE projects
SET org_id = '019508a0-0001-7000-8000-000000000000'
WHERE org_id IS NULL;
ALTER TABLE projects ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS projects_org_id_idx ON projects (org_id);

-- Backfill tokens.org_id then enforce NOT NULL.
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);
UPDATE tokens
SET org_id = '019508a0-0001-7000-8000-000000000000'
WHERE org_id IS NULL;
ALTER TABLE tokens ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS tokens_org_id_idx ON tokens (org_id);

CREATE TABLE IF NOT EXISTS email_verifications (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_id_idx
    ON email_verifications (user_id);

CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    ip          TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS org_invites (
    token       TEXT PRIMARY KEY,
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_invites_org_id_idx ON org_invites (org_id);
CREATE INDEX IF NOT EXISTS org_invites_email_idx ON org_invites (lower(email));
