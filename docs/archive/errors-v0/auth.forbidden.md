# `auth.forbidden`

> Sentori recognised the caller (token is valid, session is alive)
> but the requested action requires a permission the caller doesn't
> have on this resource.

## What this means

Distinct from `auth.invalidToken` (caller unknown) and
`auth.missingToken` (no credentials at all) — here Sentori knows
who you are and is saying "you can't do that here". Typical
boundaries:

- A `viewer`-role member trying to edit project settings.
- A signed-in user from org A trying to read a project in org B.
- An ingest token (`st_pk_*`) trying to call an admin endpoint —
  ingest tokens have ingest scope, not management scope.
- A non-owner trying to delete the last admin from an org.

## Why you got it

Almost always one of two reasons:

1. **Role mismatch**: the user was added with `viewer` or `member`
   and the action requires `admin` or `owner`.
2. **Org boundary**: the URL pointed at a project the caller can
   see but can't modify (e.g. a sibling project in another org
   they happen to be a viewer of).

## How to fix it

Ask an org owner to upgrade your role (Org settings > Members), or
have them perform the action. If you believe the role check is
wrong, the response carries an `X-Sentori-Correlation-Id` header
the operator can grep for in the server log to confirm the
decision path.

---

*Edit this file under `docs/errors/auth.forbidden.md` to update
the docs surface.*
