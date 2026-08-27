# `security.invalidReport`

> Sentori rejected a `POST /v1/security:report` payload because one
> or more fields failed validation.

## What this means

The security ingest endpoint enforces minimal shape requirements
to keep the trust scoring engine's input bounded. Common rejections:

- `kind` empty or longer than 100 characters
- `userId`, `installId`, `release`, or `environment` empty when set
- any string field over its column cap (`userId` 200, `installId`
  64, `release` 200, `environment` 64, `serverName` 200)

Per-field details ride in `error.details[]` so the caller can fix
the offending value.

## Why you got it

Almost always one of two reasons:

1. **Empty optional string passed in instead of omitting it** — `""`
   is a real value to validation, not "absent". Send `undefined` or
   skip the key entirely.
2. **A hand-rolled `reportSecurity()` call** that doesn't go through
   the SDK helpers — the typed helpers (`reportPinMismatch`) avoid
   this by setting only fields they know are well-formed.

## How to fix it

Use the SDK helpers (`sentori.reportPinMismatch({...})`) when their
shape applies. For custom kinds, read `error.details` from the
response body and adjust the offending field. The cap exists to keep
the security event row size bounded — splitting one large kind into
two smaller ones is preferred to pushing the cap.

---

*Edit this file under `docs/errors/security.invalidReport.md` to
update the docs surface.*
