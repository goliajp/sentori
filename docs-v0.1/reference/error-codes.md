# Error codes reference

Sentori v0.1 returns errors as `(StatusCode, body)` from
every HTTP handler. The status code is the primary
classifier; the body is a human-readable string. Future
versions will move to a structured `{error, code,
message}` envelope (see _Planned: structured error
envelope_ below).

## Status code conventions

| Status | Meaning | Typical cause |
|---|---|---|
| 200 | OK | success |
| 202 Accepted | Event accepted into the queue | `POST /v1/events/:id` success |
| 204 No Content | Mutation succeeded; no body | `POST /v1/saas/tenants/:id/suspend` |
| 400 Bad Request | Caller-side bug | malformed JSON, missing required field |
| 401 Unauthorized | Auth missing / invalid | token absent or wrong |
| 403 Forbidden | Auth OK but permission denied | K16 ACL gate rejection |
| 404 Not Found | Resource doesn't exist | unknown `:project_id`, deleted tenant |
| 409 Conflict | Idempotency violation | duplicate slug on tenant create |
| 422 Unprocessable Entity | Domain rule violation | empty action on audit_logs insert |
| 429 Too Many Requests | K17 quota exceeded | `Decision::OverLimit` from BillingService |
| 500 Internal Server Error | Unexpected backend failure | DB connection drop, panic, K-tier `Err` not mapped |
| 501 Not Implemented | Route stub | `/v1/events` (legacy path pending K2 token middleware) |
| 503 Service Unavailable | Dependency down | postgres unreachable on `/healthz` |

## K-tier error → HTTP mapping

| K-tier error variant | HTTP status | Notes |
|---|---|---|
| `IdentityError::NotAMember` | 403 | K16 wraps as `TenantError::NotAMember` |
| `IdentityError::EmailTaken` | 409 | signup conflict |
| `IngestError::InvalidEvent` | 400 | malformed event body |
| `IngestError::ProjectNotFound` | 404 | unknown project FK |
| `IssueStoreError::IssueNotFound` | 404 | unknown issue id |
| `BillingError::NotInitialised` | 500 | bootstrap path failed; ops needs to investigate |
| `BillingError::Decision::OverLimit` | 429 | quota exceeded; body includes `current/limit` |
| `NotifierError::Transport(...)` | 502-style (returned as 500) | upstream SMTP/webhook failure |
| `TenantError::NotVisible` | 403 | User-role asking for non-granted project |
| `TenantError::InsufficientRole` | 403 | role doesn't include the permission |
| `IntegrationError::OAuth` | 502-style (returned as 500) | upstream vendor OAuth rejected |
| `IntegrationError::Upstream` | 502-style (returned as 500) | vendor API non-2xx |
| `AlertRuleError::RuleNotFound` | 404 | unknown rule id on update/delete |
| `SavedViewError::ViewNotFound` | 404 | unknown view id |
| `AuditError::InvalidInput` | 400 | empty action / oversize target string |

## SDK ingest specifics

`POST /v1/events/:project_id` failure body shape:

```
quota exceeded: 100050/100000 events this period
ingest: project not found
ingest: invalid event: error_type required
```

`POST /v1/saas/tenants` failure body shape:

```
slug "ACME-CO" fails safety check          # 400
slug "acme" already exists                  # 409
create tenant DB: ...                       # 500
```

## Health degradations

`GET /healthz` returns either `200` with `{"status":"ok"}`
or `503` with `{"status":"degraded","db":"down"}`. Use
the boolean `status` field, not just the HTTP code, in
your load-balancer probe wiring.

## Planned: structured error envelope

v0.2 will move every handler to a uniform envelope:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "current 100050 over limit 100000",
    "details": { "kind": "events", "current": 100050, "limit": 100000 }
  },
  "request_id": "..."
}
```

This is tracked under v0.2 design discussions; until
then handlers return string bodies.

## Reporting bugs

If you find a path that returns the wrong status code,
or a 500 that should be a typed 4xx, file an issue:
[New issue → bug report](https://github.com/goliajp/sentori-selfhosted/issues/new?template=bug_report.md).
Include the exact request + response + the server log
line.
