# `domain.badRequest`

The Sentori server returned **HTTP 400** with the code
`domain.badRequest` and a free-form message describing what the
request was missing or shaped incorrectly. Distinct from
`domain.validation`, which carries a structured per-field detail
list — `domain.badRequest` is used for cross-field rules that
can't be expressed as a single-field `validator` check.

## What this means

A request reached the endpoint but failed a *combined* constraint
the server enforces after per-field validation passed. Example:
`POST /v1/events` with `kind = "message"` requires both `level`
and a non-empty `message` body; sending just one fails this check.
Per-field validation succeeds individually (each field's value is
shape-valid in isolation), but the rule across them rejects.

## Why you got it

The most common triggers in v2.0:

- `POST /v1/events` with `kind = "message"` missing `level` or
  `message`. The server's `validate_event_kind` enforces this
  combined rule (see `server/src/api/events.rs`).
- `POST /v1/events` with `kind ∈ {"error", "anr", "nearCrash"}`
  missing the `error` object. Same dispatch — error-class events
  must carry the structured error payload.

The response body's `error.message` field carries the exact
problem so calling code can show it to the operator without
needing to inspect the request shape.

## How to fix it

Look at the response body's `error.message` — it spells out the
missing/mismatched field. Common fixes:

- Use a v2-supported SDK (`@goliapkg/sentori-react-native@2`+)
  rather than constructing the request by hand. Library calls
  populate the combined rule automatically.
- For hand-crafted ingest tooling, ensure `kind` and its
  associated payload travel together (`kind: 'message'` needs
  `level` + `message`; `kind: 'error'` needs `error: { type,
  message, stack }`).

---

*Edit this file under `docs/errors/domain.badRequest.md` to update the docs surface.*
