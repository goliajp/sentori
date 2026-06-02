# `trust.invalidInstallId`

> Sentori received a `GET /v1/security/score?installId=…` request
> with an `installId` value outside the accepted shape (1–64 chars).

## What this means

The install id column on `security_events` is `TEXT` capped at 64
characters (matching the SDK's `install-id` module). The trust
score endpoint enforces the same cap so an oversized parameter
can't hit the database with a value the database would reject
anyway.

## Why you got it

Two common causes:

1. An empty `installId=` parameter — `""` is a real value to the
   validator. Omit the parameter (you'll get `trust.missingInstallId`
   instead) or pass a real id.
2. A non-SDK caller using its own id scheme that exceeds 64 chars —
   typically a session-id-like value that's been concatenated with
   other context.

## How to fix it

Use the SDK helper (`sentori.queryTrustScore()`) which reads the
canonical install id from local storage. For raw HTTP calls, ensure
the value is the UUID the SDK persists — usually a 36-char string
with dashes. Reject `""` client-side rather than sending it.

---

*Edit this file under `docs/errors/trust.invalidInstallId.md` to
update the docs surface.*
