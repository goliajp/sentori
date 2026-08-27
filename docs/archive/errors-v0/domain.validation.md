# `domain.validation`

> The request body parsed as JSON but at least one field violated
> Sentori's validation rules.

## What this means

Sentori enforces minimal but real shape rules at the ingest
boundary — string-length caps, enum membership, required fields,
non-negative durations. When validation fails the response's
`error.details[]` lists exactly which fields failed and why, so
callers can fix the offending value without guessing.

## Why you got it

Common patterns:

1. **A string field over its cap**: e.g. a `release` longer than
   200 chars (some monorepos build very long release tags); a
   `route` over 200 chars when a deep-link query string got
   appended.
2. **An empty optional string**: `userId: ""` is a real value to
   the validator, not "absent". Send `undefined` or skip the key.
3. **An enum miss**: `status: "happy"` for a session ping (only
   `ok | errored | crashed | exited` are accepted).
4. **A negative number where bounded positive is required**:
   typically `durationMs` from a clock-skew bug.

## How to fix it

Read `error.details[]` and fix the listed fields. The shape is
`[{ field: "release", message: "longer than 200 chars" }, …]`.
Field paths use dot-notation for nested values
(`device.osVersion`).

For SDK developers: validation failures from SDK-emitted events
usually mean a bug in the SDK's input collection (the SDK should
have capped the field itself). Open an issue with the
correlation id from the response header — that's enough to find
the exact call in the server log.

---

*Edit this file under `docs/errors/domain.validation.md` to update
the docs surface.*
