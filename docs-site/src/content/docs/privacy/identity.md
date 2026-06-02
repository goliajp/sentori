---
title: Identity & cross-project user lookup
description: How Sentori correlates one user's events across projects without storing PII.
---

# Identity & cross-project user lookup

Sentori v2.3 introduces cross-project user lookup. An operator
can answer the question "which projects has user X hit issues
in?" — without Sentori ever storing user X's raw email or phone.

This page documents the privacy contract and the operator
workflow.

## TL;DR for operators

You hand Sentori a real email when looking someone up:

```
Users page → input field
  type: email
  value: lihao@golia.jp
```

Your browser hashes the value via SHA-256 before anything leaves
the page. The URL becomes:

```
/users?type=email&hash=a3f8c92d…
```

The hash gets POSTed to the server. The server compares it
(after layering an org-private salt on top) against the
`identity_fingerprints` table — a denormalized index of every
event's identity hashes. You see per-project hit counts.

The raw email is NEVER stored, logged, displayed, or sent
anywhere. Sentori cannot recover it from anything on the server.

## TL;DR for hosts integrating the SDK

```ts
sentori.setUser({
  id: 'usr_internal_123',
  name: 'Lihao',                  // optional, display only
  linkBy: {
    email: 'lihao@golia.jp',      // hashed by SDK before send
    googleSub: '108293…',         // ditto
  },
})
```

The SDK normalizes (`email.lowercase().trim()`, phone E.164,
etc.) then SHA-256-hashes via `crypto.subtle`. The wire payload
ships only `linkHashes: { email: 'a3f8…', googleSub: 'b2c1…' }`.

If you pass raw values to a Sentori server somehow (via a
non-Sentori SDK or a buggy client), the server REJECTS the event
at validation — every `linkHashes` value must match `^[a-f0-9]{64}$`.

## The full privacy contract

### What never leaves the device

- `linkBy.email`, `linkBy.phone`, `linkBy.googleSub`,
  `linkBy.appleSub`, `linkBy.metaSub`, `linkBy.username`, and any
  custom keys
- Anything else you pass under `linkBy.<custom>`

### What's stored raw (server-side)

- `user.id` — your internal pseudonym. Stored verbatim. If your
  app uses email as user-id, **put it in `linkBy.email` instead.**
- `user.name` — display only. Set to a pseudonym if you don't
  want real names in our DB.

### What's stored hashed

- For every `linkBy.<key>` value the SDK sent, an entry in
  `identity_fingerprints (event_id, scope_id, key_type, fingerprint)`
  where `fingerprint = sha256(scope.salt || key_type || ':' || sha256(normalized_raw_value))`.

### What's NOT stored

- IP addresses (server does geo-resolve then discards)
- Browser / device fingerprints (only OS + OS version + locale +
  app version — clearly aggregate)
- Anything in event payloads marked as PII by the server-side
  scrubber

### Scope isolation

The `identity_scope` salt is **per-org by default**. Two orgs
asking about the same email produce different stored fingerprints
in their respective scopes. Cross-org lookup is impossible by
construction — there's no API surface, and even if you DB-dumped
both scopes, the fingerprints would never match.

### What an attacker who stole the database can do

- See `id` and `name` raw if you put PII there (your choice)
- See SHA-256 fingerprints in `identity_fingerprints`. These are
  **salted** with per-org salts stored separately in
  `identity_scopes.salt`. Reversing requires:
  1. Also obtaining the `identity_scopes` table (separate
     physical isolation)
  2. Running a rainbow table against the candidate raw values

  If the attacker has BOTH the events table AND the scope table,
  they could in principle attempt a brute-force inversion on
  email-like values. The mitigation is that this requires a
  full-DB breach including encrypted-at-rest tables, and per-org
  salts mean each org is a separate brute-force target.

We don't claim this is GDPR-pseudonymization-class for the
strictest interpretations; we claim it's audit-safe under
data-minimization principles. Hosts in highly-regulated industries
(healthcare, finance) should consult their own DPO before relying
on linkBy for PII-bearing operations.

### What the SDK promises

1. `setUser({ linkBy: { email: 'a@b.com' } })` never sends `a@b.com`.
2. The SDK has no fallback that sends raw email — if
   `crypto.subtle` is unavailable, hashing fails and `linkBy` is
   dropped silently (NEVER rule: never propagate to host).
3. The SDK's wire-format field is named `linkHashes` (different
   from the user-facing `linkBy`). Server validation rejects any
   `linkHashes` value that doesn't look like a 64-char hex sha256
   — defense-in-depth against a buggy/malicious client.

### What the dashboard promises

1. The Users page input field has `autoComplete=off` and
   `data-1p-ignore` so password managers don't capture the raw value
2. On submit, the raw value is hashed THEN immediately cleared
   from React state. It exists in memory for one event loop tick.
3. URL state holds only the hash. Browser history sees only the
   hash. Operator can refresh / share-link / paste-URL — no raw value
   resurfaces.

## Operator workflow

The intended flow is:

1. Customer support gets a real complaint via email or chat:
   "I'm lihao@golia.jp, my checkout is crashing."
2. Operator opens Sentori → Users tab.
3. Inputs `type=email`, `value=lihao@golia.jp` (paste).
4. Clicks "look up". Browser hashes; URL becomes
   `/users?type=email&hash=a3f8c92d…`.
5. Server returns: 5 events across 2 projects in your org, last
   seen 2 minutes ago.
6. Operator clicks through to issue list or specific project to
   triage.
7. Operator closes tab. Raw email gone from everywhere
   (dashboard didn't persist it; only the hash is in URL/history).

Operator can share the URL with another teammate. The teammate
opens the URL and sees the same data — without anyone needing to
re-share the raw email.

## Implementation pointers

- Client hashing: `web/src/lib/identity-hash.ts`
  (browser-side mirror of SDK normalization)
- SDK hashing: `sdk/core/src/identity.ts` (single source of truth)
- Server schema: `server/migrations/0065_identity_scopes.sql`
- Server fingerprint computation: `server/src/identity.rs`
- Server lookup endpoint: `server/src/api/admin/identity_lookup.rs`
- Dashboard Users view: `web/src/modules/users/view.tsx`

## What's not built yet (planned)

- **Identity merge**: operator declares "these two fingerprints
  are the same person" (deferred to v2.4).
- **GDPR DSR purge**: input email → server hashes → DELETE all
  events with matching fingerprint (deferred until first
  compliance ask).
- **Project-level scope carve**: split a project into its own
  scope so it doesn't correlate with the rest of the org's events.
  Schema is ready; admin UI deferred to v2.4.
- **Region-level scopes**: data residency. Architecturally
  supported via additional scope rows; not exposed yet.

If you're an operator hitting one of these gaps, file an issue
at github.com/goliajp/sentori with your concrete use case.
