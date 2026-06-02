# `internal.unexpected`

> Sentori hit an unexpected condition inside a handler — distinct
> from "service degraded" (`internal.dbDown`) or any of the
> classified domain / auth errors.

## What this means

The catch-all server-side 500. Every reachable code path is supposed
to map to a specific error code; this one means a handler returned
an `AppError::Internal(...)` rather than a typed variant. The
response body carries the correlation id but no internal message —
the message lives in the server log, indexed by that id.

## Why you got it

Almost always a server-side bug that the team needs to see. Common
underlying causes:

1. A downstream service (Valkey, the mailer, GeoIP db) returned an
   unexpected error shape.
2. A serialization path hit a value the type system thought was
   impossible.
3. A migration ran behind a code deploy and a query touched a
   column that doesn't exist yet.

## How to fix it

For callers: retry once after a few seconds — a fraction of these
are transient. If the second attempt also fails, the SDK's offline
queue will retry on its own schedule.

For operators: grep server logs for the response's correlation id
and surface the full backtrace. If the same id keeps reappearing,
classify the underlying error and add a typed variant so the next
hit produces a domain-specific code.

---

*Edit this file under `docs/errors/internal.unexpected.md` to
update the docs surface.*
