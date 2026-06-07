-- v2.7 W2 — per-project per-provider push credentials.
--
-- The `config` JSONB holds the non-secret fields (key id, team id,
-- bundle id, sandbox/production default, FCM project id, VAPID
-- public key, etc.) which are safe to surface in admin GET responses
-- so the dashboard can show "APNs configured: key ABC, team DEF" at
-- a glance without round-tripping the secret.
--
-- The `secret_blob` is the AES-256-GCM ciphertext of the secret
-- payload (see `secrets.rs`). Per-provider shape:
--   * apns    — { "p8": "-----BEGIN PRIVATE KEY-----..." }
--   * fcm     — full service-account JSON
--   * webpush — { "vapidPrivate": "..." }
--   * hcm     — { "appSecret": "..." }
--   * mipush  — { "appSecret": "..." }
--
-- One row per (project, provider) — a project that ships to both
-- iOS and Android needs two rows.

CREATE TABLE push_credentials (
    id            UUID         PRIMARY KEY,
    project_id    UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider      TEXT         NOT NULL CHECK (provider IN ('apns','fcm','webpush','hcm','mipush')),
    config        JSONB        NOT NULL,
    secret_blob   BYTEA        NOT NULL,
    secret_nonce  BYTEA        NOT NULL CHECK (octet_length(secret_nonce) = 12),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (project_id, provider)
);
