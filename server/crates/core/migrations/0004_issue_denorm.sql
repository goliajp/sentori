-- Phase 6 sub-section B: denormalize latest event env/release onto issues
-- so the dashboard list can show them per issue without a join.

ALTER TABLE issues ADD COLUMN IF NOT EXISTS last_environment TEXT;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS last_release TEXT;
