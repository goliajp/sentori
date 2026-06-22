-- saas/migrations/0001_control_plane.sql — Sentori SaaS control plane.
--
-- Control-plane schema lives in its own postgres database
-- (`sentori_saas`). Each tenant gets a SEPARATE postgres
-- database (`sentori_t_<slug>`) containing the K-tier schema
-- (core/migrations/0001-0015). The K crates run unchanged
-- against the tenant DB — they think they're operating on a
-- single-workspace install (which they are, just one per
-- tenant).
--
-- Per CSaas1+5 autonomous design 2026-06-21:
--   tenants                — registry of provisioned tenants
--   tenant_provisions      — async provision job state
--   subscriptions          — Stripe sync state per tenant
--   stripe_events          — webhook dedup ledger
--   saasadmin_users        — control-plane admin accounts
--                            (different from tenant users)
--   saasadmin_sessions     — control-plane session cookies

-- ── tenants ─────────────────────────────────────────────────
-- One row per provisioned tenant. `db_name` is the postgres
-- database the tenant's K-tier workload lives in. Slug is the
-- subdomain piece (e.g. `acme` → `acme.sentori.example.com`).
CREATE TABLE IF NOT EXISTS tenants (
    id              UUID         PRIMARY KEY,
    slug            TEXT         NOT NULL UNIQUE
                                  CHECK (slug ~ '^[a-z][a-z0-9-]{1,30}[a-z0-9]$'),
    display_name    TEXT         NOT NULL,
    db_name         TEXT         NOT NULL UNIQUE,
    -- 'provisioning' | 'active' | 'suspended' | 'deleted'
    status          TEXT         NOT NULL DEFAULT 'provisioning'
                                  CHECK (status IN ('provisioning', 'active', 'suspended', 'deleted')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    activated_at    TIMESTAMPTZ,
    -- Email of the initial owner — bootstrap script seeds
    -- the tenant DB with this user as Owner.
    owner_email     TEXT         NOT NULL,
    -- Stripe customer ref (NULL for free / trial / OSS-self-
    -- hosted-promoted-to-SaaS tenants).
    stripe_customer_id TEXT      UNIQUE
);
CREATE INDEX IF NOT EXISTS tenants_status_idx
    ON tenants (status) WHERE status != 'deleted';

-- ── tenant_provisions ──────────────────────────────────────
-- Provisioning is async (create DB + run migrations + seed
-- owner). Each step records progress so a crashed mid-flight
-- provision can resume.
CREATE TABLE IF NOT EXISTS tenant_provisions (
    id           UUID         PRIMARY KEY,
    tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- 'create_db' | 'migrate' | 'seed_owner' | 'activate'
    step         TEXT         NOT NULL,
    -- 'pending' | 'running' | 'done' | 'failed'
    state        TEXT         NOT NULL DEFAULT 'pending',
    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error        TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_provisions_tenant_idx
    ON tenant_provisions (tenant_id, created_at DESC);

-- ── subscriptions ──────────────────────────────────────────
-- One row per (tenant, stripe_subscription_id). Mirror of
-- Stripe sub state for ops visibility — auth-of-record lives
-- at Stripe itself. Webhook handler upserts.
CREATE TABLE IF NOT EXISTS subscriptions (
    id                       UUID         PRIMARY KEY,
    tenant_id                UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    stripe_subscription_id   TEXT         NOT NULL UNIQUE,
    -- 'free' | 'pro' | 'enterprise' (matches K17 Plan enum)
    plan                     TEXT         NOT NULL,
    -- Mirrors Stripe Subscription Status (active / past_due
    -- / canceled / trialing / unpaid / incomplete).
    status                   TEXT         NOT NULL,
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    cancel_at_period_end     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_tenant_idx
    ON subscriptions (tenant_id);

-- ── stripe_events ──────────────────────────────────────────
-- Dedup ledger. Stripe redelivers webhooks up to 3× when our
-- response is slow — `stripe_event_id` UNIQUE + idempotent
-- INSERT means re-deliveries are no-ops.
CREATE TABLE IF NOT EXISTS stripe_events (
    id                 UUID         PRIMARY KEY,
    stripe_event_id    TEXT         NOT NULL UNIQUE,
    event_type         TEXT         NOT NULL,
    payload            JSONB        NOT NULL,
    -- 'pending' | 'processed' | 'failed'
    processed_state    TEXT         NOT NULL DEFAULT 'pending',
    received_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    processed_at       TIMESTAMPTZ,
    error              TEXT
);
CREATE INDEX IF NOT EXISTS stripe_events_pending_idx
    ON stripe_events (received_at) WHERE processed_state = 'pending';

-- ── saasadmin_users ────────────────────────────────────────
-- Control-plane staff accounts. Distinct from tenant users
-- so a compromised tenant credentials can't escalate to
-- cross-tenant admin.
CREATE TABLE IF NOT EXISTS saasadmin_users (
    id              UUID         PRIMARY KEY,
    email           TEXT         NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    display_name    TEXT         NOT NULL,
    -- 'staff' | 'super' (super has tenant-delete + cross-
    -- tenant impersonation; staff is read-only).
    role            TEXT         NOT NULL CHECK (role IN ('staff', 'super')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

-- ── saasadmin_sessions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS saasadmin_sessions (
    id              UUID         PRIMARY KEY,
    user_id         UUID         NOT NULL REFERENCES saasadmin_users(id) ON DELETE CASCADE,
    token_hash      TEXT         NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    user_agent      TEXT,
    ip_addr         TEXT
);
CREATE INDEX IF NOT EXISTS saasadmin_sessions_expires_idx
    ON saasadmin_sessions (expires_at);
