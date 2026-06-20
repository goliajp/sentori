-- Phase 14 sub-section A: tokens metadata for dashboard listing.
-- `label` is a free-text tag the user picks at create time (e.g. "ios-prod").
-- `last4` is the last 4 chars of the raw token, captured at create time so
-- the dashboard can show a partial fingerprint without storing the secret.

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS last4 TEXT;
