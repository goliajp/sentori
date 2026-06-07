# Push notifications — architecture

Status: **design accepted 2026-06-07**. Implementation rolls out across v2.7 – v2.12 (see roadmap row for each version).

Reference (read-only): `/Users/doracawl/workspace/qualcomm/insight/apps/insight-push-server` — the insight push server is **studied** as a prior art (APNs + FCM dispatcher + bad-token streak + circuit breaker + retry semantics), not vendored. Sentori's implementation re-writes from the design below, with broader provider coverage (APNs / FCM / Web Push / HCM / MiPush), tighter SDK matrix integration (RN native module + Expo plugin + JS Service Worker), and Sentori's own license (Apache-2.0 OR MIT).

## Decisions (frozen 2026-06-07)

| # | Decision | Choice |
|---|---|---|
| 1 | Provider credentials at rest | **Encrypted in DB.** New `server/src/secrets.rs` AES-256-GCM envelope; master key derived from `SENTORI_SESSION_SECRET + per-row salt`. No filesystem path fallback — keeps the SaaS path single. |
| 2 | `device_tokens.user_fingerprint_hex` | **Yes, optional column.** When SDK supplies a `linkHash`, server computes `identity::compute_fingerprint(salt, key_type, linkHash)` and stores the 32-byte BYTEA. Enables "push every device owned by user X" without touching identity_fingerprints PK shape. **Indexed, not FK** — identity_fingerprints PK is `(event_id, scope_id, key_type)`, FK would force per-event coupling. |
| 3 | Sidebar chord | **`n`** (`g n` → Push dashboard module — Notifications). |
| 4 | Sidebar group | **`manage`** — push is configure-and-watch, not a triage lens. Sits alongside Teams / Webhooks / Integrations. |
| 5 | Opt-in default | **Off.** SDK `init.push.enabled` default `false`. Host app calls `sentori.push.register()` explicitly — permission prompt is host UX, not Sentori's to surprise. Same precedent as `trackAutoBreadcrumb` (default `false`). |
| 6 | Network host | **Reuse `ingest.sentori.golia.jp`.** One token, one URL, one host — customer ingest config covers both error + push. No `push.sentori.golia.jp` subdomain. |

## Five-layer architecture

```
Layer 1 — App-side SDK
  • sentori-react-native: iOS APNs bridge (Obj-C/Swift) + Android FCM bridge (Kotlin)
  • sentori-javascript: Service Worker + VAPID + Push API (browser)
  • sentori-expo: config plugin (Info.plist aps-environment, AndroidManifest svc, EAS hooks)
  • sentori-react / vue / svelte / solid: hook-style state wrappers
  • Surface: sentori.push.register({linkHash?, onToken, onMessage, onTap, onError})

Layer 2 — sentori-server HTTP API (reuse ingest.sentori.golia.jp)
  • POST   /v1/push/tokens                — public Bearer + rate-limited; register / refresh device token
  • DELETE /v1/push/tokens/{ipt_id}       — public Bearer + rate-limited; explicit unregister
  • POST   /v1/push/send                  — backend Bearer; sentori-native shape
  • GET    /v1/push/receipts/{send_id}    — backend Bearer
  • POST   /v1/push/expo-compat/send      — backend Bearer; Expo shape in / out (drop-in for expo-server-sdk)
  • GET    /v1/push/expo-compat/receipts/{send_id}
  + admin/api/projects/:id/push/* — credential CRUD, devices, sends listing, test-send (dashboard)

Layer 3 — server/src/push/ module tree
  • push/mod.rs               — public re-exports, Sentori-native types
  • push/tokens.rs            — register / lookup / revoke
  • push/send.rs              — enqueue + dispatch entry
  • push/delivery.rs          — receipt + retry log
  • push/dispatch_cron.rs     — spawn_cron tokio task, 30s sweep, mirrors webhook_dispatch
  • push/providers/mod.rs     — trait Provider + outcome types
  • push/providers/apns.rs    — JWT (ES256) + HTTP/2 POST /3/device/{token}
  • push/providers/fcm.rs     — OAuth (RS256 JWT-bearer) + POST messages:send
  • push/providers/webpush.rs — VAPID JWT (ES256) + AES-GCM encrypted payload
  • push/providers/hcm.rs     — Huawei Mobile Service push (v2.8+ phase)
  • push/providers/mipush.rs  — Xiaomi MiPush (v2.8+ phase)
  • push/expo_compat.rs       — wire shape translation Sentori ↔ Expo

Layer 4 — Provider abstraction (trait)
  trait Provider {
      async fn send(&self, cred: &Credential, msg: NativeMessage)
          -> Result<SendOutcome, ProviderError>;
      fn name(&self) -> &'static str;
  }
  enum SendOutcome { Sent, PermanentlyInvalidToken, EnvironmentMismatch, Transient(retry_after_secs), TerminalOther(reason) }

  Per-provider per-project: lazy-loaded `ProviderRuntime` (JWT cache, OAuth token cache, circuit-breaker
  state). Stored in `Arc<DashMap<(ProjectId, ProviderKind), Arc<ProviderRuntime>>>` on AppState.
  Same retry schedule as webhook_dispatch: [60s, 5m, 30m, 2h, 12h, 24h] capped at 6 attempts.
  Bad-token streak (mirrors insight): 3 consecutive `PermanentlyInvalidToken` → device_tokens.revoked_at.

Layer 5 — Postgres
  device_tokens         — registered devices (per project, per provider)
  push_credentials      — APNs / FCM / VAPID / HCM / MiPush configs (encrypted)
  push_sends            — one row per send, idempotency_key uniq
  push_delivery_logs    — retry log per (send, attempt) for dashboard receipt visibility
```

## Wire format

### Sentori-native (preferred — surfaces full Sentori capability)

`POST /v1/push/send`
```json
{
  "to": "ipt_abc123" | ["ipt_abc123", "ipt_xyz789"],
  "title": "New comment",
  "body": "Alex replied to your issue",
  "data": { "issueId": "iss_xyz", "url": "/issues/iss_xyz" },
  "options": {
    "sound": "default" | null,
    "badge": 3,
    "priority": "normal" | "high",
    "ttl": 3600,
    "mutableContent": true,
    "contentAvailable": false,
    "collapseKey": "iss_xyz",
    "channelId": "comments",
    "category": "MESSAGE_CATEGORY"
  },
  "idempotencyKey": "biz-event-uuid"
}
```
Returns
```json
{ "ticket": { "id": "send_abc", "status": "queued", "createdAt": "2026-06-07T..." } }
```
Receipt `GET /v1/push/receipts/send_abc`
```json
{ "ticket": {
    "id": "send_abc",
    "status": "queued" | "sent" | "failed",
    "providerOutcome": "APNS_200" | "FCM_invalid_argument" | ...,
    "error": null | "DeviceNotRegistered" | "MessageTooBig" | "InvalidCredentials" | "RateLimited" | "Transient" | "InternalError",
    "retryCount": 0,
    "sentAt": null | "2026-06-07T..."
  }
}
```

### Expo-compat (drop-in)

`POST /v1/push/expo-compat/send` accepts Expo's exact shape (single message or array, fields `to`/`title`/`body`/`data`/`sound`/`badge`/`priority`/`ttl`) and returns `{ data: [{ status: 'ok', id }] | { status: 'error', id?, message, details:{ error } }] }`. Server-side: translate to NativeMessage, dispatch, translate outcome back. Same recipe as insight's compatibility shim.

## DB schema

### `device_tokens` (migration 0075)
```sql
CREATE TABLE device_tokens (
    id                    UUID PRIMARY KEY,                       -- ipt_* prefix on wire, UUID at rest
    project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider              TEXT NOT NULL CHECK (provider IN ('apns','fcm','webpush','hcm','mipush')),
    env                   TEXT CHECK (env IN ('sandbox','production')),  -- APNs only; null for others
    native_token          TEXT NOT NULL,
    user_fingerprint_hex  BYTEA,                                  -- optional 32-byte identity fingerprint
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { bundleId, locale, osVersion, sdkVersion, ... }
    bad_streak            INTEGER NOT NULL DEFAULT 0,
    revoked_at            TIMESTAMPTZ,                            -- set by streak hit or explicit DELETE
    last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, provider, native_token)
);
CREATE INDEX device_tokens_project_active_idx ON device_tokens (project_id) WHERE revoked_at IS NULL;
CREATE INDEX device_tokens_user_active_idx ON device_tokens (user_fingerprint_hex) WHERE revoked_at IS NULL;
```

### `push_credentials` (migration 0076)
```sql
CREATE TABLE push_credentials (
    id            UUID PRIMARY KEY,
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    provider      TEXT NOT NULL CHECK (provider IN ('apns','fcm','webpush','hcm','mipush')),
    config        JSONB NOT NULL,             -- non-secret: { keyId, teamId, bundleId, envDefault, fcmProjectId, vapidPublic, ... }
    secret_blob   BYTEA NOT NULL,             -- AES-256-GCM ciphertext of secret payload
    secret_nonce  BYTEA NOT NULL,             -- 12-byte nonce
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, provider)
);
```
Secret payload by provider:
- **apns**: `{ "p8": "-----BEGIN PRIVATE KEY-----..." }`
- **fcm**: full service-account JSON
- **webpush**: `{ "vapidPrivate": "..." }`
- **hcm**: `{ "appSecret": "..." }`
- **mipush**: `{ "appSecret": "..." }`

### `push_sends` (migration 0077)
```sql
CREATE TABLE push_sends (
    id                UUID PRIMARY KEY,                              -- send_* on wire
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token_id          UUID NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
    provider          TEXT NOT NULL,
    payload           JSONB NOT NULL,                                -- normalized NativeMessage
    status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','sent','failed')),
    provider_outcome  TEXT,                                          -- "APNS_200" / "FCM_invalid_argument" / ...
    error             TEXT,                                          -- normalized error code
    retry_count       INTEGER NOT NULL DEFAULT 0,
    idempotency_key   TEXT,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at           TIMESTAMPTZ,
    UNIQUE (project_id, idempotency_key)
);
CREATE INDEX push_sends_pending_idx ON push_sends (next_attempt_at) WHERE status = 'queued';
CREATE INDEX push_sends_token_recent_idx ON push_sends (token_id, created_at DESC);
```

### `push_delivery_logs` (migration 0078)
```sql
CREATE TABLE push_delivery_logs (
    id                UUID PRIMARY KEY,
    send_id           UUID NOT NULL REFERENCES push_sends(id) ON DELETE CASCADE,
    attempt           INTEGER NOT NULL,
    outcome           TEXT NOT NULL,                                 -- e.g. "Sent" / "Transient(retry_after=30)" / "PermanentlyInvalid"
    provider_status   INTEGER,                                       -- HTTP status from provider
    provider_body     TEXT,                                          -- truncated to 2 KB
    duration_ms       INTEGER,                                       -- network round-trip
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_delivery_logs_send_idx ON push_delivery_logs (send_id, attempt);
```

## SDK matrix per package

| Package | Push surface |
|---|---|
| `@goliapkg/sentori-core` | `PushApi` types; `pushSend({apiKey, baseUrl}, msg)` server-side fetch helper |
| `@goliapkg/sentori-javascript` | `sentori.push.registerWeb({serviceWorkerUrl, vapidPublicKey, linkHash?, onMessage, onTap, onError})`; Service Worker template |
| `@goliapkg/sentori-react-native` | iOS native module (UIApplication delegate + APNs token); Android native module (FCM via `com.google.firebase:firebase-messaging`); JS API `sentori.push.register({...})` |
| `@goliapkg/sentori-expo` | Config plugin: inserts `aps-environment` entitlement + `UIBackgroundModes:remote-notification` + FirebaseMessagingService AndroidManifest service registration + EAS build profile hooks |
| `@goliapkg/sentori-next` | Server-side `sentori.push.send(msg, {projectId})` for Next.js API / Server Actions, using server-side env vars |
| `@goliapkg/sentori-react / vue / svelte / solid` | `useSentoriPush()` (React/Vue/Svelte/Solid idioms): state for `[permission, token, lastMessage, error]` |
| `@goliapkg/sentori-cli` | `sentori push send -p <project> --to <ipt> --title "..." --body "..."` ; `sentori push devices ls -p <project>` ; `sentori push creds set-apns -p <project> --key-id ... --p8 @key.p8` |

## Opt-in semantics (decision #5)

- SDK config `init({ push: { enabled: false } })` is the default — no permission prompt, no native registration call.
- Host app calls `sentori.push.register({...})` when ready (typically after onboarding step where it shows its own "Enable notifications?" UX).
- Inside `register()`: SDK requests OS permission → fetches APNs/FCM token → POSTs `/v1/push/tokens` → stores `ipt_*` locally → `onToken({ipt})` callback fires.
- `sentori.push.unregister()` revokes locally + DELETE `/v1/push/tokens/{ipt}`.
- Notification arrival callbacks (`onMessage` foreground, `onTap` user-tapped) are fire-and-forget JS-level — they don't touch the server.

## Concurrent expectations

- **Provider runtime cache**: in-memory `DashMap<(ProjectId, ProviderKind), Arc<ProviderRuntime>>` lazily populated on first send-to-that-provider. Invalidated when credentials are PATCHed.
- **Per-tenant rate limit**: same `rate_limit_middleware` as ingest; provider-side limits hit via circuit breaker (10 consecutive non-recoverable fails → 60s open window).
- **HTTP client**: AppState gains `http_client: reqwest::Client` reused across providers (5s connect, 10s read timeout, HTTP/2 enabled).
- **Dispatch cron**: `push::dispatch_cron::spawn_cron()` ticks every 30s, batched 50 rows per sweep. Mirrors `webhook_dispatch`.

## Performance gates (per Sentori铁律)

- SDK register flow may not block main thread > 5ms on cold start (native modules run on background dispatch queue / coroutine).
- onMessage handler default is no-op — host app opts in to JS work.
- Webpush Service Worker must not auto-cache resources beyond the push payload (avoid bandwidth surprise).
- Per-platform: iOS register cost (Instruments Time Profiler) and Android register cost (`dumpsys cpuinfo`) measured before each provider release.

## Versioned rollout

| Version | Scope |
|---|---|
| **v2.7** | Server foundation — push module + APNs + FCM providers + 4 migrations + secrets.rs + ingest routes + Expo-compat endpoint. raw REST `curl`-validatable. SDK matrix unchanged. |
| **v2.8** | Web Push provider (VAPID) + `sentori-javascript` Service Worker + `sentori-next` server send + recipe. |
| **v2.9** | `sentori-react-native` iOS native module (APNs delegate). |
| **v2.10** | `sentori-react-native` Android native module (FCM). |
| **v2.11** | `sentori-expo` config plugin + dashboard `push` module + chord `g n` + cred CRUD UI. |
| **v2.12** | HCM + MiPush providers + cross-SDK re-exports (react/vue/svelte/solid hooks) + perf bench + docs/recipes consolidated. |

## Out of scope (deferred)

- **Topic / segment broadcasts** (FCM topic publish, APNs group). v2.13+ — needs DB-side groups + UI.
- **Scheduled sends** ("send at 9 AM local user time"). v2.13+ — needs cron + user timezone column.
- **A/B test or variant payloads**. Not in the engineering-bug-tracker workflow.
- **Apple Notification Service Extension auto-injection** (rich media decryption). v2.12+ — Expo plugin or native sample.
- **Service Worker for service-side data sync** (PWA full offline). Service Worker only handles push payloads in v2.8.

## License

Apache-2.0 OR MIT (matches Sentori monorepo). All code authored by GOLIA K.K.. The insight-push-server prior art is **referenced** only — design notes derived from reading its public source, no code copied. Sentori implementation is independently written.

## Related

- `docs/roadmap/v2.7.md` — phase 1 closeout
- `docs/roadmap/v2.8.md` … `v2.12.md` — subsequent phases (created when each starts)
- `docs/runbook/push-credentials.md` — operator runbook for APNs / FCM cred provisioning (created with v2.11 dashboard cred UI)
- `docs-site/recipes/push-from-api-route.md` — customer recipe (created with v2.8)
- `server/src/secrets.rs` — secret-encryption layer first user
