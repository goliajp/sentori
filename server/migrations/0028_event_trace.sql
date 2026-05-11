-- Phase 36 sub-C: link events to traces.
--
-- Both columns nullable — every existing row gets NULL, and SDKs that
-- don't carry tracing context (legacy clients, manual captures
-- outside a span) emit events with these fields unset. The dashboard
-- shows an "In trace →" pill only when trace_id is set.
--
-- ALTER on the partitioned parent propagates to every child partition
-- automatically. No backfill: legacy events simply have NULL.

ALTER TABLE events ADD COLUMN IF NOT EXISTS trace_id UUID;
ALTER TABLE events ADD COLUMN IF NOT EXISTS span_id  UUID;

-- Index covers the reverse-lookup direction the trace detail page
-- uses: "events on this span" / "events on this trace". Partial
-- because most rows will be NULL.
CREATE INDEX IF NOT EXISTS events_trace_idx
    ON events (trace_id)
    WHERE trace_id IS NOT NULL;
