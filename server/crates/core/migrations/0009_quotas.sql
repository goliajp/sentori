-- Phase 15 sub-section A: per-org plan, quota and usage counters.
-- usage_counters is the durable rollup; the hot path counts in Valkey
-- (`usage:<org_id>:<yyyymm>`) and a background task flushes to PG every
-- 60s. Both columns store cumulative counts within a calendar month.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_plan') THEN
        CREATE TYPE org_plan AS ENUM ('free', 'pro', 'enterprise');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS org_quotas (
    org_id              UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    plan                org_plan NOT NULL DEFAULT 'free',
    event_limit_monthly INTEGER NOT NULL,
    retention_days      INTEGER NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
    org_id        UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    period_yyyymm TEXT NOT NULL,
    event_count   BIGINT NOT NULL DEFAULT 0,
    dropped_count BIGINT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, period_yyyymm)
);
CREATE INDEX IF NOT EXISTS usage_counters_period_idx
    ON usage_counters (period_yyyymm);

-- Backfill every existing org with the free-tier defaults so the quota
-- check has a row to read on day one.
INSERT INTO org_quotas (org_id, plan, event_limit_monthly, retention_days)
SELECT id, 'free', 100000, 30 FROM orgs
ON CONFLICT (org_id) DO NOTHING;
