---
"@goliapkg/sentori-core": minor
"@goliapkg/sentori-javascript": minor
"@goliapkg/sentori-react-native": minor
---

v2.3 W6.1 — `beforeSend` hook + unified `withSpan` entry point.

Two additive surface changes per `docs/design/sdk-v2.3-redesign.md` §2:

**`init({ beforeSend })` — host PII scrub hook**

A sync host-supplied function called once per event just before
transport enqueue. Return the event (possibly mutated) to ship it,
or `null` to drop it entirely. Use for application-specific PII
scrubbing the SDK can't do automatically.

NEVER rule applies: a throwing hook is caught, one-shot warned, and
the SDK falls back to the unmodified event. A non-event return
(typo, `undefined`, etc.) gets the same treatment. Server-side
`privacy_lab` continues running regardless of whether `beforeSend`
is configured — `beforeSend` is the host's own defence layer in
front of the existing server scrubber.

```ts
sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.0.0',
  beforeSend(event) {
    if (event.tags?.flow === 'kyc') return null  // never ship KYC events
    return { ...event, user: undefined }         // strip user
  },
})
```

**`withSpan` — unified entry point per design §2.3**

`withSpan` now overloads by first-argument type:

- `withSpan(name: string, fn)` — high-level wrap helper. Opens a
  span, runs `fn`, ends the span. Same semantics as
  `withScopedSpan(name, fn)`.
- `withSpan(span: SpanContextLike, fn)` — low-level active-span
  manager. Pushes the span onto the active-context stack so child
  spans inherit it. Same semantics as the prior `withSpan` export
  (and the new explicit name `withActiveSpan`).

The pre-v2.3 export name `withSpan` continues to work via the new
overload (dispatching on first-arg type), so `withSpan(span, fn)`
call sites are source-compatible. The explicit name
`withActiveSpan` is exported for hosts that prefer disambiguation.
`withScopedSpan` remains exported as the explicit name for the
high-level path.

Tests: new RN `applyBeforeSend` dispatcher unit tests + JS SDK
`beforeSend` end-to-end tests via the fetch mock + core
`withSpan(name, fn)` overload coverage (5 new tests on top of the
v2.2 spans suite).

`BeforeSendHook` type is exported from `@goliapkg/sentori-core` and
re-exported by both SDKs.
