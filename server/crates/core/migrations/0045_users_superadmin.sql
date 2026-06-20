-- v1.0 — global superadmin flag on users.
--
-- Distinct from `OrgRole::Owner` (which is per-org). A superadmin
-- can list / mutate every org / team / project / user on the
-- instance and is the "operator god-mode" identity. Seeded by
-- `seed::ensure_superadmin` at boot from the SENTORI_SUPERADMIN_EMAIL
-- env var so the deployment can keep one authoritative super-user
-- without manual DB intervention.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS users_is_superadmin_idx ON users (is_superadmin)
    WHERE is_superadmin;
