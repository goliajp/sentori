# `federation.invalidLink`

> Sentori rejected a `POST /v1/security/link` request because one or
> more fields failed validation.

## What this means

The federation link endpoint stores `(project_id, provider, subject,
user_id?, install_id?)`. The minimum required shape is a non-empty
`provider` (≤ 64 chars) + non-empty `subject` (≤ 200 chars). The
optional `userId` and `installId` follow the same caps as elsewhere
in the SDK (200 + 64 chars respectively).

## Why you got it

Usual causes:

1. **Empty optional string** — `userId: ""` is a real value, not
   "absent". Omit the key entirely.
2. **Email-as-subject** — passing the user's email instead of the
   OAuth `sub` value. The `sub` is opaque; subject should be the
   provider's stable internal id, not a human-readable handle. This
   isn't usually a validation error (length passes) but it does
   defeat the privacy posture of the link table — please re-read
   the docs and pass the proper `sub`.
3. **Custom provider key too long** — e.g. fully-qualified
   `okta.<domain>.<env>` strings. Cap at 64 chars or split the
   namespace differently.

## How to fix it

Use the SDK helper `sentori.linkFederatedIdentity({ provider, subject,
userId? })`. Read `error.details[]` from the response for per-field
guidance.

---

*Edit this file under `docs/errors/federation.invalidLink.md` to
update the docs surface.*
