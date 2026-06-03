---
title: init.beforeSend hook
description: Sync host-side mutate-or-drop hook called once per event just before transport enqueue.
---

`init({ beforeSend })` is the SDK's escape hatch for host-side
PII scrubbing the SDK can't do automatically. Sentori already
strips a fixed set of suspicious fields (raw `email`, `phone`,
`ip_address`) and the server's privacy_lab catches anything the
ingest path missed — but every host has its own custom fields
(`employeeId`, `internalCaseRef`, `customer_pii.full_name`) that
only the host knows to redact.

```ts
sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.0.0',
  beforeSend(event) {
    // Drop entirely.
    if (event.tags?.flow === 'kyc') return null

    // Mutate + ship.
    return {
      ...event,
      tags: {
        ...event.tags,
        company_size_bucket: bucketise(event.tags?.company_size),
      },
    }
  },
})
```

## Signature

```ts
type BeforeSendHook = (event: Event) => Event | null
```

- **Return the event** (possibly mutated, possibly same reference)
  to send it.
- **Return `null`** to drop it. No transport, no breadcrumb-of-drop.
- **Synchronous.** Async pre-send mutation is deliberately not
  supported — that would let a buggy host stall the SDK's hot
  path.

## NEVER-rule fallback

Both `captureException` and `captureMessage` invoke `beforeSend`
inside a try/catch:

- If the hook **throws**, the SDK swallows the error, emits one
  one-shot `logger.warn`, and falls back to the **unmodified**
  event.
- If the hook returns a **non-event** (e.g. `undefined`, `42`,
  another object without an `id`), same fallback policy.

A buggy `beforeSend` cannot stall, drop-by-mistake, or break the
capture pipeline.

## Common patterns

### Strip a host-specific PII tag

```ts
beforeSend(event) {
  if (event.tags?.employeeId) {
    const { employeeId, ...safeTags } = event.tags
    return { ...event, tags: safeTags }
  }
  return event
}
```

### Drop events from internal QA users

```ts
beforeSend(event) {
  if (event.user?.id?.startsWith('qa-')) return null
  return event
}
```

### Coerce a high-cardinality field to a bucket

```ts
beforeSend(event) {
  const raw = event.tags?.['db.duration_ms']
  if (raw === undefined) return event
  const n = Number(raw)
  return {
    ...event,
    tags: {
      ...event.tags,
      'db.duration_bucket': n < 50 ? 'fast' : n < 500 ? 'mid' : 'slow',
    },
  }
}
```

## What `beforeSend` is NOT

- **Not a transport replacement.** The hook can drop or mutate,
  but it can't redirect the event to a different endpoint. Use
  `init.ingestUrl` for self-hosted Sentori.
- **Not a sampling knob.** Use `init.sample.errors` /
  `init.sample.traces` / `init.sample.messages` for that — they
  decide *before* the event is built, which is cheaper than
  building + dropping.
- **Not for breadcrumb scrubbing.** Breadcrumbs are inside
  `event.breadcrumbs` — you can mutate that array — but for
  scrubbing the breadcrumb stream itself, host's
  `sentori.addBreadcrumb` call sites are where the original
  data lives. Wrap at that site if you want.

## Sentry-compat note

The Sentry-compat sub-package
(`@goliapkg/sentori-react-native/compat`) **refuses** to support
the full Sentry `beforeSend` signature shape (it accepts a Hint
parameter, async returns, and the rest of the historical
contract). Sentry-compat hosts who pass `Sentry.init({
beforeSend })` get a one-shot info hint pointing them at this
page — call `sentori.init({ beforeSend })` directly instead.

## Related

- [`api/init`](./init.md) — where you wire the hook
- [`api/capture`](./capture.md) — the events that flow through it
- [`privacy/identity`](../privacy/identity.md) — SDK-side identity strip
- [`sentry-compat`](../sentry-compat.md) — the compat layer's stance
