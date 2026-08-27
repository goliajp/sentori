# `auth.missingToken`

> Sentori received an ingest request without an `Authorization`
> header (or with one in the wrong shape).

## What this means

Every `/v1/*` endpoint requires the project's public ingest token in
`Authorization: Bearer st_pk_…`. Sentori rejects requests with no
header, an empty header, or any non-`Bearer` scheme before doing any
work — the body isn't parsed and no quota is consumed.

## Why you got it

The most common causes:

1. **SDK not initialised**: `sentori.init({ token, … })` never ran on
   this device — usually because the host crashed before init, or
   the token came back as `undefined` from env loading.
2. **Hand-rolled curl / API client** that forgot the header.
3. **A reverse proxy stripping `Authorization`** — some setups
   replace the header with a custom `X-Auth-Token` and forget to
   forward the original.

## How to fix it

For SDK callers: confirm `sentori.init` ran and didn't throw. The
token must start with `st_pk_` (public ingest scope) — `sk_` keys
won't work here and will produce `auth.invalidToken`.

For raw HTTP: include `Authorization: Bearer st_pk_<token>` on every
request. The token belongs to the project you're ingesting against
and can be created from the dashboard's Project > Tokens panel.

For proxies: forward the `Authorization` header verbatim; don't
rewrite it.

---

*Edit this file under `docs/errors/auth.missingToken.md` to update
the docs surface.*
