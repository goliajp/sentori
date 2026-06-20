-- v1.1 chunk S4 — federated identity links.
--
-- A "federated identity" is a (provider, subject) tuple — e.g.
-- (google, "118712341234123412341") or (github, "12345"). The same
-- federated identity can show up under different sentori user ids
-- across projects (a user signed in with the same Google account in
-- two apps that both report to sentori). The federation link table
-- records that mapping so the trust scoring engine + Posture
-- dashboard can stitch cross-project signals onto one logical user.
--
-- Privacy posture: this table never stores email / display name /
-- avatar etc — only the opaque federation `subject` value the OAuth
-- provider issued. The SDK passes (provider, subject) at link time;
-- it does NOT pass the email or any other identity attribute. The
-- subject is treated as a pseudonymous correlator.

CREATE TABLE IF NOT EXISTS user_federation_links (
    id          UUID        PRIMARY KEY,
    project_id  UUID        NOT NULL,
    provider    TEXT        NOT NULL,
    subject     TEXT        NOT NULL,
    user_id     TEXT,
    install_id  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A single (project, provider, subject) link can be re-asserted
    -- safely; the SDK does this on every sign-in to keep install_id
    -- up to date. The ON CONFLICT path in the ingest handler updates
    -- user_id + install_id and bumps created_at as the "last seen"
    -- pointer.
    UNIQUE (project_id, provider, subject)
);

CREATE INDEX IF NOT EXISTS user_federation_links_provider_subject_idx
    ON user_federation_links (provider, subject);
