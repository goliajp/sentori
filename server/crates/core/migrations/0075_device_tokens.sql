-- v2.7 W2 — registered push device tokens.
--
-- One row per (project, provider, native_token). Mobile / browser
-- client registers via POST /v1/push/tokens (public Bearer auth),
-- gets back an `ipt_<uuid>` handle that's used in every subsequent
-- send call. The handle masks the native token so the backend
-- integrator never sees an APNs/FCM raw token.
--
-- `user_fingerprint_hex` is the 32-byte identity_fingerprints
-- fingerprint computed at registration when the SDK supplies a
-- `linkHash`. It's indexed (not FK) so "send to every device of
-- user X" is a fast lookup, without coupling to identity_fingerprints'
-- composite PK.
--
-- `bad_streak` tracks consecutive PermanentlyInvalidToken outcomes
-- from the provider. The push dispatcher increments on each failure
-- and resets to 0 on Sent; on streak=3 it sets `revoked_at = now()`
-- so the device drops out of future fan-outs. Mirrors the same
-- semantics insight-push-server uses (the prior art).

CREATE TABLE device_tokens (
    id                    UUID         PRIMARY KEY,
    project_id            UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider              TEXT         NOT NULL CHECK (provider IN ('apns','fcm','webpush','hcm','mipush')),
    env                   TEXT         CHECK (env IN ('sandbox','production')),
    native_token          TEXT         NOT NULL,
    user_fingerprint_hex  BYTEA        CHECK (user_fingerprint_hex IS NULL OR octet_length(user_fingerprint_hex) = 32),
    metadata              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    bad_streak            INTEGER      NOT NULL DEFAULT 0,
    revoked_at            TIMESTAMPTZ,
    last_seen_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (project_id, provider, native_token)
);

-- "Active devices for project X" — sidebar count, send fan-out base
CREATE INDEX device_tokens_project_active_idx
    ON device_tokens (project_id)
    WHERE revoked_at IS NULL;

-- "Active devices for user X" — push to a specific identified user
CREATE INDEX device_tokens_user_active_idx
    ON device_tokens (user_fingerprint_hex)
    WHERE revoked_at IS NULL AND user_fingerprint_hex IS NOT NULL;
