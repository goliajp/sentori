# SDK integration

The v0.1 backend exposes a minimal ingest API the SDK
posts to. The full SDK package (`@sentori/react-native`,
native iOS/Android, etc.) ships on its own cadence.

## Endpoint

```
POST {base_url}/v1/events/{project_id}
Content-Type: application/json
```

Fields (camelCase ish — the binding is in
`self-hosted/server/src/handlers/ingest.rs`):

```json
{
  "kind": "error",
  "error_type": "TypeError",
  "message": "x is undefined",
  "platform": "javascript",
  "release": "myapp@1.0.0",
  "environment": "production"
}
```

- `kind` — `error` / `message` / `anr` / `near_crash`
  per the K4 event-pipeline enum.
- `platform` — `ios` / `android` / `javascript` /
  `web` / `node`. Anything not in the recognised set
  defaults to `ios`.
- `release` / `environment` — caller-defined strings,
  used as filter dims by K9 metrics + K14 alert rules.

## Response

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "event_id": "01928a7b-…",
  "issue_id": "01928a7c-…",
  "is_new": true
}
```

- `is_new` — true on the first event of a fingerprint
  (drives "new issue" K14 alert firing).

## Errors

| Status | Meaning |
|---|---|
| 400 | Malformed body / K4 validation rejection. |
| 404 | Unknown `project_id`. |
| 429 | K17 quota check returned `OverLimit` for the workspace's plan. Caller should drop + retry next period. |
| 500 | Backend failure. |

## Auth (v0.1 skeleton)

The v0.1 OSS skeleton accepts anonymous ingest. Token-
based auth (DSN-equivalent) lands once the K2 auth-session
HTTP middleware ships (Phase 4 continuation).

For now the firewall layer (Caddy / nginx / cloud LB)
should restrict `/v1/events/*` to known SDK origins, or
the deployment should be private-network-only.

## Healthcheck

```
GET /healthz → 200 {"status":"ok","db":"ok","version":"0.1.0"}
```

Use this in load-balancer probes + container healthchecks.
