-- v0.8.4 — Certificate Transparency monitoring.
--
-- Customer registers a domain they own and the server polls crt.sh
-- every 10 minutes for any new certificates issued for that domain
-- (including subdomain matches via crt.sh's `%domain` wildcard). Each
-- never-before-seen cert lands as a row in `cert_observations` and
-- triggers an email notification — so an attacker getting a rogue
-- cert issued for the customer's domain is observable within a few
-- minutes of the issuance.
--
-- We're NOT running a self-hosted CT log follower: those need to
-- process millions of certs/sec across global logs to be useful, and
-- the operational cost dwarfs the value for our customer base.
-- crt.sh aggregates all major CT logs into a free public search and
-- our latency budget (15 min) is comfortable inside what poll gives.
--
-- Domain match: we store `domain` and query crt.sh with `%domain` so
-- `example.com` watch catches `example.com`, `www.example.com`, and
-- any subdomain. The customer can register `*.subset.example.com` to
-- narrow if they're chunking responsibilities across teams.

CREATE TABLE IF NOT EXISTS cert_watch_domains (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain      TEXT NOT NULL CHECK (char_length(domain) BETWEEN 3 AND 253),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, domain)
);

CREATE INDEX IF NOT EXISTS cert_watch_domains_project_idx
    ON cert_watch_domains (project_id);

-- One row per crt.sh cert ID we've seen for any of the watched
-- domains. `cert_id` is crt.sh's BIGINT primary key — globally
-- unique across the public CT logs, so the (project_id, cert_id)
-- UNIQUE constraint dedupes re-poll runs without us having to track
-- "last_seen_id" cursor state.
CREATE TABLE IF NOT EXISTS cert_observations (
    id           UUID PRIMARY KEY,
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain       TEXT NOT NULL,
    cert_id      BIGINT NOT NULL,
    common_name  TEXT,
    -- crt.sh returns all SANs in one newline-delimited string. Caps
    -- around 8 KB to keep the row small; rare wildcard certs with
    -- 100+ SANs may get truncated but every customer-relevant SAN
    -- still fits.
    name_value   TEXT,
    issuer_name  TEXT NOT NULL,
    not_before   TIMESTAMPTZ NOT NULL,
    not_after    TIMESTAMPTZ NOT NULL,
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, cert_id)
);

CREATE INDEX IF NOT EXISTS cert_observations_project_first_seen_idx
    ON cert_observations (project_id, first_seen DESC);

CREATE INDEX IF NOT EXISTS cert_observations_domain_idx
    ON cert_observations (project_id, domain);
