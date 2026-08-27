# `security.dataTooLarge`

> Sentori rejected a `POST /v1/security:report` payload because the
> `data` object had more than **40** keys.

## What this means

The security report's `data` field is a free-form JSON object —
intentionally permissive so per-kind helpers can attach whatever
context they need without a schema bump. The cap of 40 keys exists
to bound the JSONB row size and keep the security_events table's
ingest hot path predictable.

## Why you got it

Almost always a debug dump that landed in `data`. Common patterns:

1. **Spreading a whole config object**: `data: { ...appConfig }` —
   easy to write, but apps with many feature flags blow past 40 keys.
2. **Iterating through a context bag** the host already collects
   for crash reports and reusing it here.

## How to fix it

Pick the keys that actually matter for the security signal — usually
the suspect value, the expected value, and a handful of context tags.
Move bulk context to the breadcrumb trail (`addBreadcrumb`) or to a
companion `captureException` call, where high-cardinality keys don't
cost the security path.

For the common `pin.mismatch` shape, use the dedicated
`sentori.reportPinMismatch({ expected, observed, serverName })` helper
— it only ever sends two keys in `data`.

---

*Edit this file under `docs/errors/security.dataTooLarge.md` to
update the docs surface.*
