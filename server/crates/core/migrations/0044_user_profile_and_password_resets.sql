-- v1.0 — broaden the `users` table to support a GitHub-style account
-- surface (display name + avatar + linked OAuth identity) and add a
-- password_resets table for the forgot-password flow.
--
-- All columns added here are nullable so existing rows continue to
-- work without a forced backfill. The dashboard derives a display name
-- from the email-local-part when `display_name IS NULL`, and an
-- avatar URL from gravatar when `avatar_url IS NULL`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url   TEXT;

-- OAuth linkage. (provider, subject) is the stable identifier from
-- the upstream provider; we account-link by email at first sign-in
-- so a user who registered email/password and later "Sign in with
-- GitHub" using the same address gets attached to their existing row.
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_subject  TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_provider_subject_idx
    ON users (oauth_provider, oauth_subject)
    WHERE oauth_provider IS NOT NULL AND oauth_subject IS NOT NULL;

-- Password-reset tokens. Single-use, short-lived. Tokens are random
-- bytes urlsafe-base64-encoded server-side (256 bits ≈ 43 chars).
CREATE TABLE IF NOT EXISTS password_resets (
    token       TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx
    ON password_resets (user_id);
CREATE INDEX IF NOT EXISTS password_resets_expires_at_idx
    ON password_resets (expires_at);
