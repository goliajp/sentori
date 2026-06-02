# `track.batchTooLarge`

> Sentori rejected a `POST /v1/track:batch` payload because the batch
> contained more than **500** events.

## What this means

The track ingest endpoint caps every batch at 500 events. Larger
batches are dropped at the boundary — none of the events in the
oversized batch are persisted. The cap exists so one client can't pin
the ingest worker on a single `INSERT` loop and starve other tenants.

## Why you got it

Almost always one of three reasons:

1. **A custom flush loop**: you wired `sentori.track()` to flush
   manually but the buffer grew past 500 before the flush ran. The
   SDK's built-in flusher caps the buffer at 500 already.
2. **A retry replaying a saved batch**: a long-offline device woke up
   and tried to ship a backlog as a single batch. Split the backlog.
3. **A non-Sentori client posting to `/v1/track:batch`**: e.g. a
   server-side analytics pipeline. Page in chunks.

## How to fix it

Split the batch client-side:

```ts
const CHUNK = 500
for (let i = 0; i < events.length; i += CHUNK) {
  await sendTrackBatch(url, token, events.slice(i, i + CHUNK))
}
```

Or just rely on the SDK's auto-flusher (default 30 s interval, caps
the internal buffer at 500). The cap is by design — raising it would
let one tenant push p99 ingest latency for everyone.

---

*Edit this file under `docs/errors/track.batchTooLarge.md` to update
the docs surface.*
