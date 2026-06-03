---
title: Find users affected
description: Cross-project drill from "what's broken" to "who's broken" — operator workflow + agent / curl flow.
---

The find-user lens (v2.4) closes the loop on every incident: a
spike on the Issues board only tells you *what* broke. To
respond, you also need *who* was hit and *which subset of them
you can identify in your own customer database*. Sentori's
identity layer surfaces this without ever seeing raw email /
phone / OAuth sub — every identity is hashed client-side and
joined through a per-org salt server-side.

This recipe covers the three flows the lens supports:

1. **Issue → users affected.** Click into an issue's detail
   page; the "Affected users" panel lists the top-N fingerprints
   touching it. Drill one user.
2. **Operator lookup by raw value.** Type a customer's email
   into the Users page; browser hashes it; dashboard renders
   cross-project hits for the resulting fingerprint.
3. **Merge two fingerprints.** Same human came in through two
   `linkBy` keys (Google + email) — collapse them so future
   lookups join.

All three are also callable from an LLM agent / curl directly;
the body shapes are documented inline.

---

## Flow 1 — Issue → users affected → one user's timeline

On any issue detail page, scroll to the **"Affected users · last
7d"** panel beneath the stack trace. The panel lists up to 20
identified fingerprints touching the issue in the past week,
ordered by event count descending. Each row carries:

- **Fingerprint hex prefix** — 12 chars + `…`. Links into the
  single-fingerprint page (`/main/<org>/users/<fingerprintHex>`).
- **Key type** — `email`, `googleSub`, `phone`, etc. Tells you
  which `linkBy` channel the user came in through.
- **Event count** — within the 7-day window.
- **Last seen** — relative timestamp.

Click any row → land on that fingerprint's detail page →
timeline of every event across every project the user has hit
in the last 7 days, including issue list + per-project
breakdown. From there you decide whether to:

- Reach out to the user (your customer DB knows the raw email
  behind the hash).
- Mark them as a high-impact account (set a `tags.tier: enterprise`
  on their next setUser).
- Use the **merge identities** flow below if they appear under
  multiple fingerprints.

### Programmatic equivalent

Same query from an LLM agent or CI script:

```bash
curl -X GET \
  "https://sentori.golia.jp/admin/api/projects/$PROJECT_ID/issues/$ISSUE_ID/affected-users?days=7&limit=20" \
  -H "Authorization: Bearer $SENTORI_ADMIN_TOKEN"
```

Response:

```jsonc
{
  "issueId": "01900000-0000-7000-8000-000000000001",
  "windowDays": 7,
  "totalDistinct": 412,
  "rows": [
    {
      "fingerprintHex": "a3f8c92d…64hex",
      "keyType": "email",
      "eventCount": 51,
      "lastSeen": "2026-06-03T07:24:00Z"
    },
    // up to N more
  ]
}
```

`totalDistinct` is the unfiltered count so an agent can decide
whether to fetch additional pages (the endpoint paginates
implicitly via the `limit` knob; for a deep cohort, run several
windowed queries).

---

## Flow 2 — Lookup by raw value

Land on `/main/<org>/<project>/users` → expand the **"lookup by
identity"** bar.

1. Pick the identity type (Email / Phone / Google sub / etc.).
2. Type the raw value. Your browser hashes it via
   `crypto.subtle.digest('SHA-256', …)`. The raw value is wiped
   from React state the instant the hash is computed; only the
   hash lands in URL state and the request body.
3. Submit. Server resolves the org's default identity scope,
   computes the salted fingerprint, queries
   `identity_fingerprints` for cross-project hits.

The URL becomes shareable (e.g.
`/users?type=email&hash=<64hex>`) — refreshing the page or
sending the link to a teammate preserves the same lookup
without exposing the raw email.

### Programmatic equivalent

```bash
# Step 1 — hash the raw value (operator runs this locally; the
# raw value never leaves your machine).
HASH=$(printf '%s' "lihao@golia.jp" | tr '[:upper:]' '[:lower:]' | shasum -a 256 | awk '{print $1}')

# Step 2 — lookup.
curl -X POST "https://sentori.golia.jp/admin/api/orgs/$ORG/users/lookup" \
  -H "Authorization: Bearer $SENTORI_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"keyType\":\"email\",\"clientHash\":\"$HASH\"}"
```

Empty `hits` could mean the org has no events for that hash, the
email is genuinely unknown, or the org has no default identity
scope — the response shape is identical to avoid leaking
existence to enumeration.

---

## Flow 3 — Merge two fingerprints

The same human registered via Google in January then via email
in March — Sentori has two distinct fingerprints for them. The
merge action collapses them.

In `/main/<org>/<project>/users`, expand the **"merge
identities"** bar.

1. Enter the **primary** identity (the one you want lookups to
   resolve to).
2. Enter the **alias** identity.
3. Browser hashes both. Submit.

Future lookups against the alias hash transparently return the
primary's events. One-hop only — chains aren't followed (the
schema enforces "one primary per alias" via the `(scope_id,
alias_fp)` PK).

**Soft undo.** The success row carries an "undo this merge"
button for 7 days. Clicking it sets `undone_at` on the
identity_merges row; the row itself stays in audit history,
but the lookup-follow effect reverses. After 7 days the
button hides — the merge becomes "permanent" from a UI
standpoint (the audit row is forever, and undoing remains
possible from the API, just not from the dashboard).

### Programmatic equivalent

```bash
PRIMARY=$(printf '%s' "lihao@golia.jp" | tr '[:upper:]' '[:lower:]' | shasum -a 256 | awk '{print $1}')
ALIAS=$(printf '%s' "108762931746812345678" | shasum -a 256 | awk '{print $1}')

# Merge.
curl -X POST "https://sentori.golia.jp/admin/api/orgs/$ORG/users/merge" \
  -H "Authorization: Bearer $SENTORI_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"primary\": {\"keyType\": \"email\",     \"clientHash\": \"$PRIMARY\"},
    \"alias\":   {\"keyType\": \"googleSub\", \"clientHash\": \"$ALIAS\"}
  }"

# Undo (within or after 7 days — server has no time gate).
curl -X POST "https://sentori.golia.jp/admin/api/orgs/$ORG/users/merge/undo" \
  -H "Authorization: Bearer $SENTORI_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"alias\": {\"keyType\": \"googleSub\", \"clientHash\": \"$ALIAS\"}}"
```

---

## Audit

Every merge / undo / DSR erase writes one row to `audit_logs`:

- `action`: `identity.merged` / `identity.merge_undone` /
  `identity.erased` / `identity.erase.dry_run`.
- `target_type`: `identity_scope`.
- `target_id`: the scope UUID.
- `payload`: 8-hex prefixes of the involved fingerprints, never
  raw values or full hashes.

Surface the audit log via Settings → Audit (admin-only).

---

## What this is NOT

- **Not consent capture.** Sentori doesn't track user consent;
  if you need that, run a separate workflow against your own
  CRM / consent service. The DSR erase endpoint
  ([`privacy/dsr`](../privacy/dsr.md)) is the right hammer for
  "this user invoked their right to erasure."
- **Not a CRM.** You can't reach the user from Sentori. The
  point of the hash-and-lookup is "find the *Sentori shadow* of
  someone whose raw identity lives somewhere else."
- **Not for raw PII storage.** `payload.user.name` is the only
  raw display field Sentori stores, and that's the host's
  choice — set anonymous IDs there if you don't want real names
  in audit dumps.

## Related

- [`api/scope`](../api/scope.md) — `setUser({ linkBy })` from
  the SDK side
- [`privacy/identity`](../privacy/identity.md) — full identity
  layer audit (salt + hash + scope architecture)
- [`privacy/dsr`](../privacy/dsr.md) — operator DSR erasure
  workflow
- [`recipes/find-bugs-with-explore`](./find-bugs-with-explore.md)
  — the find-bug lens these find-user flows drill out of
