# `trust.missingInstallId`

> Sentori received a `GET /v1/security/score` request without the
> `installId` query parameter.

## What this means

The trust score endpoint scores a specific install id. Without one,
there's nothing to score — there's no implicit "current install"
context on the request because ingest tokens are project-scoped,
not device-scoped.

## Why you got it

Usually a hand-rolled call. The SDK helper
`sentori.queryTrustScore()` reads the install id from local storage
(via `getInstallId()`) and always passes it.

## How to fix it

Call `sentori.queryTrustScore()` instead of hitting the endpoint
directly, or include the parameter:

```
GET /v1/security/score?installId=<uuid>
```

The install id is the one your SDK persists to Keychain/AsyncStorage
on first launch. From server-side tooling you can pull it out of the
`security_events.install_id` column for the install you want to
score.

---

*Edit this file under `docs/errors/trust.missingInstallId.md` to
update the docs surface.*
