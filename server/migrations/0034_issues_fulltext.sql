-- Phase 44 sub-D — issues full-text search.
--
-- Generated tsvector column over `error_type + message_sample`
-- (the two strings the dashboard already shows on the list row).
-- That covers the common search:
--   - "TypeError" → finds every TypeError issue across releases
--   - "Cannot read property" → fuzzy substring on message
--
-- Uses the `simple` text-search config (no stemming, no stop-word
-- removal) because error strings mix English with symbols / paths
-- / camelCase that real-language configs mangle.
--
-- GIN over the tsvector — fast enough for hundreds of thousands of
-- issues per project; the index lives next to the row so it shares
-- the existing partition / vacuum cycle.

ALTER TABLE issues
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector(
            'simple',
            coalesce(error_type, '') || ' ' || coalesce(message_sample, '')
        )
    ) STORED;

CREATE INDEX IF NOT EXISTS issues_search_vector_idx
    ON issues USING gin(search_vector);
