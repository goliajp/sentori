# Sentori Protocol v0

> Working draft, frozen at Phase 1 of the roadmap. SDK and server **must** agree on this document before either implements changes. Any field added/removed/renamed in this file requires the matching edit in `server/src/event.rs` and `sdk/react-native/src/types.ts` in the same PR.

## Design principles

This protocol is intentionally **without legacy**. It does not maintain compatibility with Sentry, OpenTelemetry, or any other prior system. Notable choices:

- **camelCase** field names on the wire (idiomatic for JS/Swift/Kotlin clients; Rust server uses `serde rename_all = "camelCase"`).
- **Full words, never abbreviations** — `timestamp` not `ts`, `message` not `msg`, `function` not `fn`.
- **Single JSON event** — no envelope, no multipart, no streaming. One request = one or many events, all JSON.
- **Flat top-level structure** — no `contexts.{runtime, os, device, app, ...}` nesting tax.
- **Nested `cause`** for error chains, not `exceptions[]` arrays.
- **uuid-v7** for all client-generated IDs (RFC 9562, includes timestamp; sortable; modern).
- **ISO 8601 UTC, millisecond precision** for all timestamps.
- **Reserved extension slots** for `traceId` / `spanId` (distributed tracing, not implemented in v0.1).

## Versioning

API version lives in the URL path: `/v1/...`. Breaking changes ship as `/v2/`. Within a major version all changes are additive (new optional fields, new enum variants — clients ignore unknown).

## Endpoints

### `POST /v1/events`
Single event ingestion.

### `POST /v1/events:batch`
Batched ingestion. Recommended for any SDK that buffers (which all of ours do).

Trailing slashes are not significant.

## Authentication and headers

| Header | Required | Example |
|---|---|---|
| `Authorization: Bearer <token>` | yes | `Bearer st_pk_01j5y9z3vk8x4rmt2pcqjf7nw9` |
| `Sentori-Sdk` | yes | `react-native/0.1.0` |
| `Content-Type: application/json` | yes | (multipart and form-encoded are not accepted) |
| `Content-Encoding: gzip` | no | gzip body supported (recommended for batch) |
| `Idempotency-Key` | no | reserved; in v0.1 the event's `id` field acts as idempotency key |

The `Sentori-Sdk` header identifies the reporting client. Format: `<sdk-name>/<sdk-version>`. The server uses this for compatibility shimming; unknown SDKs are accepted unless a hard incompatibility is detected.

## Token and ingest URL

### Token format

`st_pk_<26 chars Crockford base32 of uuid-v7>`

- `st_` — Sentori product namespace
- `pk_` — project public key (may be embedded in client builds). The `sk_` prefix is reserved for server-only admin secret keys (post-v0.1).
- 26 chars — Crockford base32 (lowercase, no padding) of the underlying 16-byte uuid-v7. Crockford base32 avoids visually ambiguous characters (`0/O`, `1/I/L`).

Example: `st_pk_01j5y9z3vk8x4rmt2pcqjf7nw9`

The token alone identifies a project — there is no separate project ID in URLs or headers.

### Ingest URL

The SDK takes two **independent** configuration fields, never combined into a single URL:

```ts
sentori.init({
  token: 'st_pk_01j5y9z3vk8x4rmt2pcqjf7nw9',
  release: 'myapp@1.2.3+456',
  ingestUrl: 'https://ingest.sentori.golia.jp', // optional, this is the default
});
```

Self-hosted users override `ingestUrl`:

```ts
sentori.init({
  token: 'st_pk_...',
  release: 'myapp@1.2.3+456',
  ingestUrl: 'https://sentori.your-company.com',
});
```

Environment variables: `SENTORI_TOKEN`, `SENTORI_INGEST_URL`.

### No DSN URL

Sentori does **not** use Sentry's `https://<key>@<host>/<id>` DSN format:
1. URL-embedded tokens leak whenever a logging framework records request URLs.
2. Token rotation should be independent of host change.
3. Two `.env` variables are clearer than parsing a DSN string.

Documentation **must not** use the term "DSN". Always say "token + ingest URL".

## Response codes

| Code | Meaning | Body |
|---|---|---|
| `202 Accepted` | Event(s) accepted (not necessarily persisted yet) | `{}` |
| `400 Bad Request` | Schema validation failed | see below |
| `401 Unauthorized` | Missing, malformed, or unknown token | `{ "error": "unauthorized" }` |
| `413 Payload Too Large` | Event > 1 MB or batch > 1 MB | `{ "error": "payloadTooLarge" }` |
| `429 Too Many Requests` | Rate limit hit | see below; `Retry-After` header set |
| `500 Internal Server Error` | Server fault; SDK should retry with backoff | `{ "error": "internal" }` |

`400` body shape:

```json
{
  "error": "validationFailed",
  "details": [
    { "field": "error.type", "message": "required" },
    { "field": "device.os", "message": "must be one of: ios, android, web, other" }
  ]
}
```

`429` body shape:

```json
{ "error": "rateLimited", "retryAfterMs": 12000 }
```

The SDK MUST honor `retryAfterMs` (no retry sooner). On 5xx, the SDK SHOULD use exponential backoff: 1s, 2s, 4s; max 3 retries; then drop the batch.

## Event schema

A single event is a JSON object with these top-level fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string (uuid-v7) | yes | client-generated; server uses as idempotency key |
| `timestamp` | string (ISO 8601, UTC, ms precision) | yes | when the error occurred (not when reported) |
| `kind` | enum | yes | `"error"` for any throwable; `"anr"` for Android ANR / iOS hang reports (Phase 22 sub-D / sub-E). New variants are additive — receivers MUST treat unknown values as `"error"` for grouping purposes. |
| `platform` | enum | yes | `"javascript"` / `"ios"` / `"android"` (v0.2 may add `"web"`, `"node"`) |
| `release` | string | yes | format: `<app-name>@<version>+<build>` (e.g. `myapp@1.2.3+456`) |
| `environment` | string | yes | typically `"prod"`, `"staging"`, `"dev"` |
| `device` | Device | yes | physical device info |
| `app` | App | yes | application info |
| `user` | User \| null | no | omit or `null` if no user; SDK never auto-collects PII |
| `tags` | object<string, string> | no | flat key-value, max 50 keys |
| `breadcrumbs` | array<Breadcrumb> | no | up to 100 entries |
| `error` | Error | yes | the actual error |
| `fingerprint` | array<string> | no | client-suggested grouping; server may override per project rules |
| `traceId` | string \| null | no | reserved for distributed tracing (v0.1 always null/omitted) |
| `spanId` | string \| null | no | reserved for distributed tracing (v0.1 always null/omitted) |

### Device

Physical device / runtime host info.

| Field | Type | Required | Notes |
|---|---|---|---|
| `os` | enum | yes | `"ios"` / `"android"` / `"web"` / `"other"` |
| `osVersion` | string | yes | e.g. `"17.4"`, `"14"` |
| `model` | string | no | e.g. `"iPhone15,2"`, `"Pixel 8"` |
| `locale` | string (BCP-47) | no | e.g. `"ja-JP"` |

### App

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | string | yes | e.g. `"1.2.3"` |
| `build` | string | no | e.g. `"456"` |
| `framework` | Framework \| null | no | non-null for cross-platform runtimes |

#### Framework

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | e.g. `"react-native"`, `"flutter"`, `"capacitor"` |
| `version` | string | yes | framework version |

### User

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | no | application-defined |
| `anonymous` | boolean | no | hint for the dashboard |

The SDK **must not** auto-collect email, phone, IP, device IDs, or any other PII. Only what the application explicitly sets via `sentori.setUser(...)`.

## Error schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | string | yes | e.g. `"TypeError"`, `"NSInvalidArgumentException"`, `"java.lang.RuntimeException"` |
| `message` | string | yes | human-readable message |
| `stack` | array<Frame> | yes | top-of-stack first |
| `cause` | Error \| null | no | nested cause; recursive (max depth 10) |

Sentry uses `exceptions[]` to express cause chains. Sentori uses **nested `cause`**, which matches the natural structure of JS / Swift / Kotlin throwable causes.

## Frame schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `function` | string | no | function or method name; may be `"<anonymous>"` |
| `file` | string | yes | relative path or filename |
| `line` | int | yes | 1-indexed |
| `column` | int | no | 1-indexed |
| `inApp` | boolean | yes | true for application code, false for vendor/runtime |
| `absolutePath` | string | no | absolute file path (used by iOS / Android frames) |
| `preContext` | array<string> | no | source lines before, max 5 |
| `postContext` | array<string> | no | source lines after, max 5 |
| `debugId` | string | no | LC_UUID of the binary (32 hex, dashes optional). When present together with `instructionAddress`, the server symbolicates this frame against the matching uploaded dSYM. Phase 22 sub-B. |
| `arch` | string | no | atos arch family — `arm64` / `arm64e` / `x86_64` / `arm64_32` / `armv7` / `armv7s` / `armv7k` / `x86_64h` / `i386`. Required if `debugId` is set. |
| `instructionAddress` | int or string | no | PC at crash time. Decimal int or `"0x..."` hex. |
| `imageAddress` | int or string | no | base address the binary was loaded at (ASLR slide). Same encoding as `instructionAddress`. The server resolves `instructionAddress - imageAddress` against the DWARF tables. |

When the server resolves a native frame it overwrites `function`,
`file`, and `line` with the DWARF lookup result and flips `inApp` to
true. The native fields stay on the frame for re-symbolication after
later dSYM uploads.

## Breadcrumb schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `timestamp` | string (ISO 8601) | yes | breadcrumb timestamp |
| `type` | enum | yes | `"nav"` / `"net"` / `"log"` / `"user"` / `"custom"` |
| `data` | object | yes | shape depends on `type`, see below |

### Breadcrumb `data` by type

`nav` — navigation events:
```json
{ "from": "Home", "to": "Checkout" }
```

`net` — network requests:
```json
{ "method": "POST", "url": "https://api.example.com/x", "status": 500, "durationMs": 234 }
```

(SDKs SHOULD strip query strings of well-known auth params: `token`, `key`, `password`, `secret`.)

`log` — log statements:
```json
{ "level": "warn", "message": "deprecated API used" }
```

`user` — user interaction:
```json
{ "action": "tap", "target": "submit_button" }
```

`custom` — application-defined:
```json
{ "anything": "user-defined" }
```

## Batch wrapper

`POST /v1/events:batch` body:

```json
{ "events": [ /* up to 100 Event objects */ ] }
```

Constraints:
- batch body ≤ 1 MB (after gzip decode)
- ≤ 100 events per batch
- All events MUST belong to the same project (single `Authorization` header)
- Mixed `platform` values are allowed within one batch

If any single event fails validation, **only** that event is rejected (the batch is not failed wholesale). Response body lists per-event status:

```json
{
  "accepted": 97,
  "rejected": 3,
  "errors": [
    { "index": 4, "error": "validationFailed", "details": [...] },
    { "index": 22, "error": "validationFailed", "details": [...] },
    { "index": 81, "error": "validationFailed", "details": [...] }
  ]
}
```

Single-event endpoint always returns `202` with empty body, or one of the error codes above.

## Size limits

| Item | Limit |
|---|---|
| single event payload (decoded) | 1 MB |
| batch payload (decoded) | 1 MB |
| breadcrumbs per event | 100 |
| stack frames per error | 100 |
| cause chain depth | 10 |
| tag keys per event | 50 |
| tag value length | 200 chars |
| tag key length | 64 chars |

Events exceeding any of these are rejected with `400` listing the violated limit in `details`.

## Rate limits

Per-token sliding window. Default: **5000 requests/min**, configurable per project. Counts requests, not events (a batch of 100 counts as 1 request).

When hit:
- HTTP `429`
- Body: `{ "error": "rateLimited", "retryAfterMs": <ms> }`
- `Retry-After: <seconds>` header (rounded up)
- SDK MUST exponential-backoff and not retry sooner than `retryAfterMs`

## Examples

### Example 1: JS TypeError (React Native, JS layer)

```json
{
  "id": "01j5y9z3vk8x4rmt2pcqjf7nw9",
  "timestamp": "2026-05-09T12:34:56.789Z",
  "kind": "error",
  "platform": "javascript",
  "release": "myapp@1.2.3+456",
  "environment": "prod",
  "device": {
    "os": "ios",
    "osVersion": "17.4",
    "model": "iPhone15,2",
    "locale": "ja-JP"
  },
  "app": {
    "version": "1.2.3",
    "build": "456",
    "framework": { "name": "react-native", "version": "0.74.1" }
  },
  "user": {
    "id": "u_abc123",
    "anonymous": false
  },
  "tags": {
    "screen": "Checkout",
    "feature_flag.new_pay": "on"
  },
  "breadcrumbs": [
    {
      "timestamp": "2026-05-09T12:34:50.000Z",
      "type": "nav",
      "data": { "from": "Home", "to": "Checkout" }
    },
    {
      "timestamp": "2026-05-09T12:34:55.000Z",
      "type": "net",
      "data": {
        "method": "POST",
        "url": "https://api.example.com/checkout",
        "status": 500,
        "durationMs": 1200
      }
    }
  ],
  "error": {
    "type": "TypeError",
    "message": "Cannot read property 'foo' of undefined",
    "stack": [
      {
        "function": "handleSubmit",
        "file": "src/screens/Checkout.tsx",
        "line": 42,
        "column": 10,
        "inApp": true
      },
      {
        "function": "onPress",
        "file": "src/components/Button.tsx",
        "line": 15,
        "column": 5,
        "inApp": true
      }
    ]
  }
}
```

### Example 2: iOS NSException (React Native, iOS native layer)

```json
{
  "id": "01j5y9z47vke3hxh8x9k2r4gpz",
  "timestamp": "2026-05-09T12:35:01.234Z",
  "kind": "error",
  "platform": "ios",
  "release": "myapp@1.2.3+456",
  "environment": "prod",
  "device": {
    "os": "ios",
    "osVersion": "17.4",
    "model": "iPhone15,2",
    "locale": "en-US"
  },
  "app": {
    "version": "1.2.3",
    "build": "456",
    "framework": { "name": "react-native", "version": "0.74.1" }
  },
  "user": null,
  "tags": {},
  "breadcrumbs": [],
  "error": {
    "type": "NSInvalidArgumentException",
    "message": "*** -[__NSArrayM objectAtIndex:]: index 5 beyond bounds [0 .. 2]",
    "stack": [
      {
        "function": "-[CheckoutViewController submitOrder]",
        "file": "CheckoutViewController.m",
        "line": 87,
        "inApp": true,
        "absolutePath": "/Users/dev/myapp/ios/MyApp/CheckoutViewController.m"
      },
      {
        "function": "-[UIControl _sendActionsForEvents:withEvent:]",
        "file": "UIControl.m",
        "line": 0,
        "inApp": false
      }
    ]
  }
}
```

### Example 3: Android RuntimeException with cause chain

```json
{
  "id": "01j5y9z4hp8mqr3kxc9p5tnz4w",
  "timestamp": "2026-05-09T12:35:08.456Z",
  "kind": "error",
  "platform": "android",
  "release": "myapp@1.2.3+456",
  "environment": "prod",
  "device": {
    "os": "android",
    "osVersion": "14",
    "model": "Pixel 8",
    "locale": "ja-JP"
  },
  "app": {
    "version": "1.2.3",
    "build": "456",
    "framework": { "name": "react-native", "version": "0.74.1" }
  },
  "user": { "id": "u_xyz", "anonymous": false },
  "tags": { "screen": "Checkout" },
  "breadcrumbs": [],
  "error": {
    "type": "java.lang.RuntimeException",
    "message": "Failed to submit order",
    "stack": [
      {
        "function": "com.myapp.checkout.CheckoutViewModel.submit",
        "file": "CheckoutViewModel.kt",
        "line": 42,
        "inApp": true
      }
    ],
    "cause": {
      "type": "java.io.IOException",
      "message": "Connection reset by peer",
      "stack": [
        {
          "function": "okhttp3.internal.http.RetryAndFollowUpInterceptor.intercept",
          "file": "RetryAndFollowUpInterceptor.kt",
          "line": 87,
          "inApp": false
        },
        {
          "function": "okhttp3.RealCall.execute",
          "file": "RealCall.kt",
          "line": 154,
          "inApp": false
        }
      ]
    }
  }
}
```

## Audit-event webhook payload (forward-looking, Phase 27)

Sentori does not deliver webhooks today. This section locks the
contract so the audit trail and the eventual rule engine agree on the
wire format before either side ships its half. Phase 27 implements
delivery + signing; Phase 20 records the schema.

Endpoint: configured per-rule in the dashboard — anything that accepts
`POST application/json`. Sentori sends an HTTPS POST with a 5-second
connection timeout, 10-second read timeout, and at-least-once delivery
backed by an `at_*` retry queue (linear: 1m / 5m / 30m / 2h / give up
after 6 attempts).

### Headers

```
content-type:        application/json
sentori-event:       audit.org.transfer.accepted   # the action code
sentori-delivery-id: 019e0ea2-fe14-7451-9441-a22d34e0fbaa
sentori-timestamp:   1768502431                    # unix seconds, UTC
sentori-signature:   t=1768502431,v1=<hex-hmac-sha256>
user-agent:          sentori/<version>
```

The signature covers `<timestamp>.<raw-body>` with HMAC-SHA-256 keyed
by the per-rule signing secret (revealed once at rule creation, like a
public token). `t=` prevents replay — receivers MUST reject deliveries
where the timestamp is older than 5 minutes from server time. The
`v1=` prefix exists so we can rotate to `v2=<eddsa-...>` later without
breaking existing receivers.

### Body shape

```json
{
  "id":          "019e0ea2-fe14-7451-9441-a22d34e0fbaa",
  "action":      "org.transfer.accepted",
  "actionLabel": "Ownership transfer accepted",
  "occurredAt":  "2026-05-09T22:00:31Z",
  "actor": {
    "id":    "019e0e92-b22c-7302-a109-e30e00738b9c",
    "email": "old-owner@example.com"
  },
  "org": {
    "id":   "019e0e92-b4c3-7860-9b09-452d3704f90f",
    "slug": "acme",
    "name": "Acme Inc"
  },
  "target": {
    "type": "transfer",
    "id":   "019e0ea2-fe14-7451-9441-a22d34e0fbaa"
  },
  "payload": {
    "from_user_id": "019e0e92-b22c-7302-a109-e30e00738b9c",
    "to_user_id":   "019e0ea0-1111-7000-8000-aaaaaaaaaaaa"
  }
}
```

- `action` is the canonical code from `server/src/audit.rs::actions`,
  identical to what the audit log endpoint returns.
- `actionLabel` is the English-only human label from
  `audit::label_for`; localised receivers should ignore it.
- `occurredAt` is RFC 3339 in UTC, same as event timestamps elsewhere.
- `actor` is null when the action came from system code (none today).
- `org` is **null when the org has been deleted** between the action
  and webhook delivery — receivers should display "deleted org" or
  drop on the floor.
- `target.type` is one of `org / member / team / team_member /
  project / project_team / token / transfer` — the same enum the
  dashboard's audit log displays.
- `payload` is opaque JSON; its exact keys depend on `action` (see
  the table below). New keys may be added without bumping the wire
  version — receivers MUST ignore unknown keys.

### Payload contracts per action

| Action                       | Required keys                              |
|------------------------------|--------------------------------------------|
| `org.created`                | `slug`, `name`                             |
| `org.patched`                | `name`                                     |
| `org.deleted`                | `slug`, `name`                             |
| `org.transfer.requested`     | `to_user_id`                               |
| `org.transfer.accepted`      | `from_user_id`, `to_user_id`               |
| `member.role_patched`        | `role`                                     |
| `member.removed`             | `self_leave: bool`                         |
| `team.created`               | `slug`, `name`                             |
| `team.deleted`               | `slug`                                     |
| `team.member.added`          | `team_slug`, `role`                        |
| `team.member.removed`        | `team_slug`, `self_leave: bool`            |
| `project.created`            | `name`                                     |
| `project.team.bound`         | `team_slug`                                |
| `project.team.unbound`       | `team_slug`                                |
| `token.created`              | `project_id`, `kind`, `last4`              |
| `token.revoked`              | `project_id`                               |

### Delivery semantics

- **Order**: best-effort timestamp order; not strict. Receivers that
  need ordering should sort by `occurredAt` after dedup.
- **Dedup key**: `id` (uuid v7) is unique per audit row; safe to use
  as the natural key.
- **Retry**: a non-2xx response counts as a failure. Sentori retries
  up to 6 times with the schedule above; after that the delivery is
  marked `failed` and surfaces in the rule's recent-deliveries pane.
- **Body size**: payload is bounded by `audit_logs.payload` (jsonb), so
  practically < 4 KB per delivery.

## Open questions deferred

These are intentionally **not** specified in v0.1:

- Source map upload format and `POST /admin/api/releases/:r/sourcemaps` endpoint shape — Phase 8
- dSYM / ProGuard mapping upload format — post-v0.1 per ROADMAP "explicitly out"
- Server-side fingerprint override rules / per-project grouping config — Phase 5 (initial), refined later
- ~~Webhook payload format for alerting~~ — locked above (Phase 20); delivery / signing implementation in Phase 27
- Live event tail (WebSocket / SSE) for dashboard — not in v0.1
- gRPC ingestion — not in v0.1 (HTTP/JSON only)
- Replay / profiling / native crash signal handler payloads — explicitly out per ROADMAP
- Distributed tracing semantics for `traceId` / `spanId` — slot reserved, OTel-compatible meaning to be defined when first needed

## Compatibility promises

Within `/v1/`:

- The server SHALL NOT remove existing fields nor change their types.
- The server MAY add new optional fields; SDKs MUST ignore unknown fields.
- The server MAY add new enum variants; SDKs MUST treat unknown variants as `"other"` (or equivalent fallback).
- The SDK MAY omit any field marked "required: no".
- Breaking changes ship under `/v2/` with a 12-month overlap with `/v1/`.

## Document history

- **v0** — 2026-05-09 — initial draft (Phase 1 of ROADMAP).
- **v0.1** — 2026-05-10 — locked the audit-event webhook payload (Phase 20 sub-D).
