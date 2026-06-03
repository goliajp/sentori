---
title: GDPR DSR erase workflow
description: Operator workflow for honouring a data-subject erasure request — pseudonymise events + drop identity fingerprints, with a full audit trail.
---

When a user invokes their right to erasure under GDPR Art. 17
(or an equivalent regulation), Sentori provides an operator
workflow that:

1. **Pseudonymises** every event the subject appears in
   (`payload.user` overwritten with `{}`).
2. **Drops** the identity-fingerprint rows that let the subject
   be looked up across projects.
3. **Audits** the action so you can show a regulator who pulled
   the trigger, when, and how many events were affected.

The event rows themselves are kept — aggregate stats (per-release
event count, issue grouping, sourcemap coverage) survive
unchanged. GDPR accepts pseudonymisation when full deletion would
break other legitimate processing; the personal-data fields are
gone, the analytic shadow is not.

## Where it lives

`/main/<org>/<project>/users` → the "**erase identity (DSR)**"
collapsible bar at the top.

The Users module's other features (lookup, overview) sit beside
it; the DSR bar is off by default because it's a destructive op.

## Workflow

1. **Open the bar.** Click "erase identity (DSR)" to expand the
   form.
2. **Pick the identity type** (email / phone / Google sub / Apple
   sub / username / custom).
3. **Type the subject's raw value.** Your browser hashes it via
   `crypto.subtle.digest('SHA-256', …)` **before** anything
   leaves the page. The raw value is wiped from React state the
   instant the hash is computed; it never reaches the server,
   the URL, browser history, or browser storage.
4. **Click "preview impact".** The server runs a `dryRun: true`
   call: counts events matching the hashed identity in the org's
   default identity scope, returns up to 10 sample event ids.
   Nothing is mutated.
5. **Spot-check the preview.** "Hmm, this hit 412 events but I
   only expected a handful — wait, I picked the wrong key
   type." Stop here, change inputs, preview again.
6. **Type the confirmation phrase** (the literal word `erase`)
   into the gate input. The "Erase N events" button is disabled
   until the phrase matches.
7. **Click "Erase N events".** Server runs the live call:
   - DELETE matching rows from `identity_fingerprints`.
   - UPDATE matching events' `payload.user = '{}'::jsonb`.
   - INSERT one row into `audit_logs` (action
     `identity.erased`, target `identity_scope`).
   Both the DELETE + UPDATE run inside a single transaction.
8. **Confirmation message** shows the affected count and points
   at the audit log entry.

## What survives the erase

- `events.id`, `events.received_at`, `events.release`,
  `events.environment`, `events.platform`, error payloads,
  spans, breadcrumbs **without** `user`, attachments
  (screenshots are scrubbed via the redact-on-capture path; this
  workflow does not retroactively scrub already-uploaded
  screenshots — surface this caveat to your DPO).
- Issue grouping fingerprints, issue counts, release stats.

## What's gone

- `payload.user.id` / `name` / `linkHashes` — overwritten with
  `{}`.
- Every `identity_fingerprints` row for the subject across every
  event.
- Cross-project lookup for the subject — the Users module's
  "lookup by identity" form will return zero hits for the same
  hash post-erase.

## Audit trail

Every call — dry-run **and** live — writes one row to
`audit_logs`:

| Field | Value |
|---|---|
| `action` | `identity.erased` (live) or `identity.erase.dry_run` |
| `target_type` | `identity_scope` |
| `target_id` | the scope UUID the erase ran against |
| `actor_user_id` | the operator's user id |
| `payload.keyType` | e.g. `"email"` |
| `payload.affectedCount` | number of events touched |
| `payload.fingerprintPrefix` | 8-hex prefix of the server-side fingerprint |

The raw value, the client-side hash, and the full fingerprint
are **never** logged — only the 8-hex prefix, so two audit rows
for the same subject correlate without recovering the identity.

## Limitations

- **Org-default scope only.** v2.3 stores one identity scope per
  org; erase runs against that scope. When project-level scopes
  land (v2.4+), this workflow will gain a scope selector.
- **No retroactive screenshot scrub.** Already-uploaded
  screenshots are out of scope for this workflow; if your
  screenshot capture leaks PII you didn't redact at SDK time,
  the existing screenshot-redact UI (per `init.capture.screenshot`
  docs) is where to look.
- **Not undoable.** Once the live call runs, the event payloads
  are mutated in place. Take a DB snapshot first if regulator
  process requires reversibility.

## Programmatic / agent use

The same workflow is callable from an LLM agent / curl directly:

```bash
# Dry run.
curl -X POST https://sentori.golia.jp/admin/api/orgs/$ORG/users/erase \
  -H "Authorization: Bearer $SENTORI_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "keyType": "email",
    "clientHash": "a3f8c92d…<64 hex>",
    "dryRun": true
  }'

# Live.
# Same payload with "dryRun": false.
```

`clientHash` must be the 64-char lowercase hex SHA-256 of the
normalised raw value. The server rejects non-hex / wrong-length
inputs with `400`.

## Related

- [`api/init`](../api/init.md) — `identity: true|false` opts out of identity hashing
- [`privacy/identity`](./identity.md) — how `linkBy` gets hashed in the first place
- [`api/scope`](../api/scope.md) — `setUser({ linkBy })`
