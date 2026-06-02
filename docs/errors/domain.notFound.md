# `domain.notFound`

> The requested resource (project, issue, event, trace, …) doesn't
> exist — or the caller can't see it.

## What this means

Sentori returns `domain.notFound` for genuinely-absent IDs *and*
for IDs the caller isn't allowed to see. The two cases are
deliberately indistinguishable: leaking "this id exists, you just
can't see it" is a small but real information disclosure.

## Why you got it

Common cases:

1. **Stale link**: a dashboard link or webhook reference points at
   an issue / event that was deleted by retention.
2. **Wrong org**: the URL is correct but the caller switched
   active org and the resource lives in the other one.
3. **Project not yet provisioned**: an SDK ingested events under a
   project that was rebuilt; events are gone.
4. **Typo / fuzzing**: someone hand-edited the URL.

## How to fix it

For dashboard users: check the breadcrumb to confirm you're in the
right org, then re-open the resource from a list view (Issues,
Traces, Releases) rather than from the saved URL.

For SDK developers: 404s on ingest are unusual — events go under
the project that owns the token, so a 404 here means the token's
project was deleted. Roll over to a fresh token.

For API callers: don't treat 404 differently from 403; the body
is intentionally the same shape.

---

*Edit this file under `docs/errors/domain.notFound.md` to update
the docs surface.*
