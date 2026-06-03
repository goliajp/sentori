# Salt rotation — design placeholder

**Status:** design only, not implemented.
**Origin:** recovered defer from `docs/design/sdk-v2.3-redesign.md` §8.
**Audience:** future-self, when a forcing function (suspected salt
leak, regulatory rotation policy, scheduled rotation cadence) makes
this real.

---

## 0 — Why this isn't shipped

Identity scope salts are 32-byte random secrets stored in
`identity_scopes.salt` (migration `0065_identity_scopes.sql`). They
turn the SDK's deterministic client-side hash
(`sha256(linkBy.normalised)`) into a per-scope server fingerprint:

```text
stored_fp = sha256(scope.salt || key_type || ':' || client_hash)
```

Rotating the salt means:

1. Every existing `identity_fingerprints` row becomes orphaned —
   the new salt produces a different `stored_fp` from the same
   `client_hash`. Operator lookups against the new salt return
   zero hits against historical events.
2. Every historical event's `payload.user.linkHashes` needs to be
   re-fingerprinted under the new salt and re-inserted into
   `identity_fingerprints`. This is the same shape as migration
   `0067_backfill_identity_fingerprints.sql`, just bounded to one
   scope.
3. Every active `identity_merges` row needs its `primary_fp` +
   `alias_fp` recomputed under the new salt — they encode the old
   stored_fp values literally.

The cost is bounded but real: a project with 100M events and the
identity-emitting SDK adoption pattern can produce ~10M
`identity_fingerprints` rows; rotation = 10M SHA-256 calls + 10M
INSERTs (with a CONFLICT path to deduplicate). On a single
unindexed pass that's minutes; on a sharded prod cluster it's
hours.

So the trade is "occasional minutes-to-hours of write load to
re-key the identity layer" vs "doing it never until forced." Until
there's a forcing function, never is correct.

---

## 1 — Trigger conditions

Implement when **any** of:

- **Suspected leak.** Operator suspects the salt has been observed
  by an unauthorised party (DB dump leaked, backup credential
  exposed). Rotation is the credential-rotation step that makes
  the leaked salt useless against future fingerprints.
- **Regulatory cadence.** A customer's compliance program
  (rare — most don't require salt rotation, only key rotation
  for encryption) needs an N-month rotation schedule.
- **Forensic isolation.** Operator wants to "freeze" the
  pre-rotation identity space so any future PII leak through the
  hash mechanism is bounded to the post-rotation window. (Weak
  argument; better solved by limiting access to the salt.)

Until one of these fires, don't ship. The migration's complexity
+ irreversibility is much higher than the marginal security gain
from preemptive rotation.

---

## 2 — Schema sketch

```sql
ALTER TABLE identity_scopes
    ADD COLUMN previous_salt BYTEA NULL CHECK (octet_length(previous_salt) = 32),
    ADD COLUMN rotated_at    TIMESTAMPTZ NULL;

CREATE TABLE identity_fingerprints_legacy (
    -- One-time mirror of identity_fingerprints rows as they existed
    -- immediately before rotation. Operator can run lookups against
    -- the legacy salt for a grace period.
    event_id     UUID,
    scope_id     UUID,
    key_type     TEXT,
    fingerprint  BYTEA,
    received_at  TIMESTAMPTZ,
    rotated_at   TIMESTAMPTZ,
    PRIMARY KEY (event_id, scope_id, key_type)
);
```

The legacy table is the answer to "we rotated yesterday — can we
still match a fingerprint generated under the old salt?" Yes,
during the grace window, by querying both tables.

---

## 3 — Rotation flow

1. **Pre-flight check.** Operator confirms the trigger via the
   dashboard's identity-scope settings page (not yet built).
   Confirm shows the current fingerprint row count + estimated
   rotation duration.
2. **Generate new salt.** Server `gen_random_bytes(32)`; stage it
   in a temporary column (`identity_scopes.staging_salt`).
3. **Snapshot legacy.** `INSERT INTO identity_fingerprints_legacy
   SELECT *, now() FROM identity_fingerprints WHERE scope_id = $1`
   — atomic snapshot of the pre-rotation state.
4. **Recompute live.** For each row in `identity_fingerprints`,
   pull the source event's `payload->'user'->'linkHashes'->>key_type`
   raw `client_hash` and recompute `stored_fp = sha256(staging_salt
   || key_type || ':' || client_hash)`. Batch in 10k-row chunks
   to keep WAL pressure bounded.
5. **Recompute merges.** For each row in `identity_merges`, look
   up the pre-rotation `(primary_fp, alias_fp)` in
   `identity_fingerprints_legacy`, find the corresponding raw
   `(key_type, client_hash)` pairs through the snapshotted events,
   and recompute under the new salt.
6. **Atomic swap.** Single transaction: copy `salt → previous_salt`,
   copy `staging_salt → salt`, set `rotated_at = now()`, drop
   `staging_salt`. Lookup endpoint immediately uses the new salt.
7. **Grace window.** Legacy lookups remain answerable via the
   legacy table for N days (default 30). After that, scheduled
   cron purges `identity_fingerprints_legacy WHERE rotated_at <
   now() - interval 'N days'`.

---

## 4 — What this implies for the SDK

**Nothing.** The SDK only ever computes the client-side hash; it
doesn't know what salt the server uses. Hosts can rotate without
any SDK redeploy.

---

## 5 — What this implies for the dashboard

- Identity-scope settings page (not yet built) gains a "Rotate
  salt" action.
- Action is gated behind a typed-confirmation (per the DSR
  pattern in `privacy/dsr.md`) — irreversible, expensive, and
  invalidates outstanding share-links that carried the old
  fingerprint hex.
- Post-rotation, the Users module's overview tables briefly
  show "(rotating)" badges while the recompute runs in the
  background.
- Audit log entry per rotation:
  `action: 'identity.salt_rotated'`, payload echoes the
  pre-rotation row count + rotation duration + grace-window
  expiry. **Never** logs the salt value (defence in depth: the
  audit log is operator-readable, the salt is supposed to be
  ops-team-only).

---

## 6 — Open questions

- **Grace window length.** 30 days is the obvious starting point
  (one billing cycle). Could be 7 / 90 / 365 — needs a real
  customer ask.
- **Per-project carve interaction.** When a project has its own
  `identity_scope_id` (per migration `0074_projects_identity_scope.sql`),
  rotation runs against that scope only. Cross-org rotation
  needs explicit per-scope invocation.
- **Salt storage at rest.** Currently `identity_scopes.salt` is
  stored as BYTEA in Postgres; rotation doesn't change the
  storage model. KMS-backed envelope encryption of the salt
  column is a separate concern — orthogonal to rotation cadence.

---

## 7 — When to revisit

Re-read this doc when any of:

- Insight asks for salt rotation as a product feature.
- A security advisory mandates salt rotation for hash-based
  identity layers in our compliance frame.
- The `identity_fingerprints` table grows past a row count that
  makes rotation untenable without sharding.

At that point this design becomes a v2.x.y plan doc with an
implementation phase.
