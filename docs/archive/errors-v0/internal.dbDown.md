# `internal.dbDown`

> Sentori's primary database is unreachable. The request was
> rejected with HTTP 503 (Service Unavailable) and the suggestion
> to retry in 30 seconds.

## What this means

The server's Postgres connection pool returned no healthy connections
for the duration of the request, so handlers that need durable
storage can't proceed. Sentori prefers a fast-fail 503 here over
slow-fail timeouts: clients (SDKs and dashboards) can back off and
the operator gets an unambiguous signal.

Ingest endpoints typically degrade more gracefully — events buffer
in the SDK's offline queue and replay on the next successful flush.
Admin endpoints have no such buffer; they 503 immediately so the
operator notices.

## Why you got it

Three usual suspects:

1. **Database genuinely down**: outage, deploy mid-rollout, or
   storage-side incident.
2. **Connection pool exhausted**: a long-running migration or a
   batch job holding all pool slots open.
3. **Network partition**: the app pod can't reach the database
   subnet — usually a misconfigured security group or service mesh
   change.

## How to fix it

Operators: check the platform health strip on the Overview page —
the `db` column shows red when this state is reached. The
`X-Sentori-Correlation-Id` header on the response is a useful grep
target in the server log.

Callers: respect `Retry-After` if present and backoff. SDKs handle
this automatically.

---

*Edit this file under `docs/errors/internal.dbDown.md` to update
the docs surface.*
