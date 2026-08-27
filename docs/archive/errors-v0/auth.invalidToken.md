# `auth.invalidToken`

> Sentori received a bearer token that doesn't match any project's
> active ingest token.

## What this means

The token in `Authorization: Bearer …` was syntactically present
but didn't resolve to a project. Possible causes:

- The token was rotated and the SDK is still using the old value.
- The token was deleted from the dashboard but the SDK kept a copy.
- The token is a secret-scope (`st_sk_*`) admin key sent to an
  ingest endpoint (only `st_pk_*` public tokens are accepted there).
- A typo — the SDK was initialised with a partial paste.

## Why you got it

Almost always rotation. The dashboard's token list lets operators
revoke + re-issue tokens; if the new token didn't ship with the
next app release, devices in the field keep posting under the
revoked one.

## How to fix it

For SDK callers: ship the new token in the app's build config (env
var → bundle env), bump the release, and let users update. Old
releases will keep failing until the user updates — this is by
design; revoked-token traffic must not silently succeed.

For dashboard operators: when rotating, prefer creating the new
token *before* revoking the old one and keeping the overlap window
open until everyone's on the new one (telemetry under Tokens > usage
shows when the old token's traffic drops to zero).

For ingest endpoints: confirm you're sending the `st_pk_*` form —
`st_sk_*` keys belong on admin endpoints only.

---

*Edit this file under `docs/errors/auth.invalidToken.md` to update
the docs surface.*
