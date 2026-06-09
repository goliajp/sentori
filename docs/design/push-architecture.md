# Push notifications — architecture

Status: **design accepted 2026-06-07, extended 2026-06-10**. Phase 1 (v2.7 – v2.12) shipped foundation + 5 providers + cross-SDK. Phase 2 (v2.20 – v2.37+) hardens for industrial load (anti-blacklist, multi-tenant fairness, observability link-through). See roadmap row for each version.

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

## Ironclad rules (every phase ship must self-check)

### 1. Host-app performance (since v2.7)

- SDK register flow may not block main thread > 5ms on cold start (native modules run on background dispatch queue / coroutine).
- onMessage handler default is no-op — host app opts in to JS work.
- Webpush Service Worker must not auto-cache resources beyond the push payload (avoid bandwidth surprise).
- Per-platform: iOS register cost (Instruments Time Profiler) and Android register cost (`dumpsys cpuinfo`) measured before each provider release.

### 2. Provider-friendly (added v2.20)

Every SDK / server path must assume APNs/FCM/HCM will blacklist the entire sender for misbehaviour, and that the cost lands on **all** Sentori customers on this instance. The following are P0 defects:

- **Auth-token churn** — re-signing JWT or re-OAuth per send instead of caching to expiry. Concrete trigger: APNs `TooManyProviderTokenUpdates` (22001). Mitigation: `TokenCache<K, V>` abstraction (v2.20) covers APNs JWT / FCM v1 OAuth / HCM OAuth / VAPID JWT.
- **Invalid-token mass-send** — sending to a token already revoked by the OS or marked permanently invalid by the provider. Mitigation: stale-token soft eviction at `device_tokens.last_seen_at < 90d`; per-provider rolling invalid-rate counter; auto-throttle when rolling rate crosses warning threshold (v2.23).
- **Connection thrash** — opening a fresh HTTP/2 connection per send instead of reusing the long-lived stream. Mitigation: per-provider `reqwest::Client` with pool config tuned to APNs's "one persistent connection" guidance (v2.21).
- **Naive retry** — repeating identical request to a 410/Invalid token, or stampeding after a 429 without honoring `Retry-After`. Mitigation: error-code classified retry + jittered backoff + circuit-breaker per provider (v2.20 retry layer, v2.21 quarantine).
- **Rate non-limiting** — no per-provider / per-project / global send-rate cap, allowing one burst to trip provider abuse heuristics. Mitigation: three-layer rate limiter (v2.22).

### 3. Multi-tenant fairness (added v2.20)

Self-host is the first-class deployment shape. A single instance runs N projects. Any project's incident must not starve, slow, or blast-radius other projects:

- **Per-project send quota** — token-bucket per `project_id`, default sized for mid-tier self-host, override per project (v2.22).
- **Per-project resource isolation** — provider quarantine (v2.21) is scoped per `(project_id, provider)`, not global. One project's bad APNs creds do not disable APNs for siblings.
- **Per-project rate visibility** — admin dashboard surfaces each project's send rate vs quota; noisy-neighbor identification (v2.23).
- **Per-project credential isolation** — already enforced by `push_credentials.UNIQUE(project_id, provider)` since v2.7. Phase 2 extends to per-project HTTP client connection budgets when needed (v2.21).

### 4. Observability link-through (added v2.20)

Push is **not** a silo. Every send must be bi-directionally traceable to user / session / event / error / issue on Sentori's main observability surface. This is Sentori's differentiator vs Expo/OneSignal — they ship "did it leave?" indicators; we ship "what did it do?":

- **Forward** — dashboard inspects one push → which sessions opened, which events fired, which errors / issues correlate in the post-send window (v2.24 send inspector, v2.27 correlation BI).
- **Reverse** — inspecting one issue → which push messages reached the affected users in the prior 7 days (v2.27 reverse-attribution API).
- **Wire primitive** — every push send carries `_sentori.msgId` (= `push_sends.id`) in payload. SDK receive path auto-writes a `BreadcrumbType::Push` breadcrumb and emits `sentori.push.{received, opened, dismissed}` tracked events. New breadcrumb type does not break legacy dashboards (additive enum variant, must sync `sdk/core/src/types.ts` + `server/src/event.rs` per CLAUDE.md).
- **Backend primitive** — `events.push_origin_msg_id` (nullable FK), `push_impact_30d` materialized view, BI slice support for campaign / template / audience × event / error / issue (v2.27).
- **Any wire field, SDK path, or dashboard view that separates push from the main observation surface is a design defect.**

## Versioned rollout

| Version | Scope |
|---|---|
| **v2.7** | Server foundation — push module + APNs + FCM providers + 4 migrations + secrets.rs + ingest routes + Expo-compat endpoint. raw REST `curl`-validatable. SDK matrix unchanged. |
| **v2.8** | Web Push provider (VAPID) + `sentori-javascript` Service Worker + `sentori-next` server send + recipe. |
| **v2.9** | `sentori-react-native` iOS native module (APNs delegate). |
| **v2.10** | `sentori-react-native` Android native module (FCM). |
| **v2.11** | `sentori-expo` config plugin + dashboard `push` module + chord `g n` + cred CRUD UI. |
| **v2.12** | HCM + MiPush providers + cross-SDK re-exports (react/vue/svelte/solid hooks) + perf bench + docs/recipes consolidated. |
| **v2.20** | **Industrial-load foundation.** TokenCache abstraction (APNs/FCM/HCM/VAPID). Smart retry — error-code classified + jitter. Send API gate — payload size / per-token rate / batch cap. Root `VERSION` source. `scripts/check-cargo-features.sh` lint. `sign_jwt` smoke tests for apns/webpush/fcm. Closes hotfix follow-up P1-P4. |
| **v2.21** | Per-provider connection isolation + quarantine. Each provider gets its own `reqwest::Client` (idle/pool/ALPN tuned); consecutive 5xx → quarantine the provider for N seconds. |
| **v2.22** | Three-layer rate limit. L1 per-provider token-bucket (respect 429 `Retry-After`); L2 per-project quota; L3 global inflight cap. Burst 2-3×. |
| **v2.23** | Invalid-token health + blacklist early-warning. Rolling invalid / 429 / timeout ratios. Auto-throttle when crossing thresholds. Stale-token soft eviction. Dashboard "safety margin to blacklist" gauge. |
| **v2.24** | Send inspector + Receipt API + replay. Per-send timeline (enqueue → token cache hit → provider request → response → ack); `GET /v1/push/sends/:id`; "replay last N days" UI. Downstream-impact column joining the post-send window's sessions / events / errors. |
| **v2.25** | RN wire fields. `collapseId` / `interruptionLevel` / `threadIdentifier` / `categoryId` / `mutableContent` / `contentAvailable` / `richMedia.image` / `ttl + expiration` dual form / Android `tag`. **`_sentori.msgId` payload primitive** + send-API `campaignId / templateId / audienceTag` for BI slicing. |
| **v2.26** | RN receive/ack loop. confirmed-delivery ack (background batched, never blocks foreground) + token rotation listener (auto re-register) + `setNotificationHandler` + `getPresentedNotifications / dismiss / badge` + provisional/ephemeral permission + background task. Native-side persistent breadcrumb buffer (FIFO + AsyncStorage) merged into SDK on init. Auto-track `sentori.push.{received, opened, dismissed}`. Ack carries `user_fingerprint + session_id`. |
| **v2.27** | Push × User correlation BI. `events.push_origin_msg_id` FK + index. `push_impact_30d` materialized view. "Push correlation" dashboard view — cohort comparison (recipient vs control on error rate / session rate / retention). Reverse attribution: `GET /admin/api/projects/:id/issues/:id/push-origins`. |
| **v2.28** | iOS Notification Service Extension + Android BigPicture (rich media). Expo plugin auto-injects NSE target template + entitlements. Android `NotificationCompat.BigPictureStyle` auto-engaged when `richMedia.image` present. NSE runs in a separate process — zero host-app overhead. |
| **v2.29** | RN interactive actions. iOS `UNNotificationCategory` + button + textInput; Android `RemoteInput` + action buttons. SDK `registerCategory(id, actions)`; handler returns `actionId + userText` to JS. |
| **v2.30** | RN Android channel API. Channel CRUD / importance / sound / vibration / lights / badge / DnD bypass. SDK `setNotificationChannelAsync`. Default channel `default` auto-created. |
| **v2.31** | RN local schedule. TIME_INTERVAL / DATE / DAILY / WEEKLY / CALENDAR / `getNextTriggerDateAsync` — purely device-side, OS-managed. |
| **v2.32** | iOS critical alert + VoIP push (PushKit). Expo plugin capability injection. Wire `interruptionLevel: 'critical'`. PushKit callback bridge. Critical-alert entitlement onboarding. |
| **v2.33** | Live Activity / Dynamic Island (iOS 16+). ActivityKit + push-to-start token registration. SDK `startActivity / updateActivity / endActivity`. Strict respect for Apple's 4-8/h frequent-update budget (anti-blacklist applies here too). |
| **v2.34** | Topic / Interest pub-sub. `device.subscribeTopic / unsubscribeTopic`; server `publish to topic`. `device_topics` table. FCM topic publish reused + APNs/MiPush/HCM in-house fanout. |
| **v2.35** | Scheduled sends. send API `sendAt: rfc3339` + optional `recurring: cron`. Independent scheduler tick. User-timezone column. Dashboard schedule view. |
| **v2.36** | User-based publishing + multi-device fanout. wire `to: { userId }`; server fanouts to all active `device_tokens` for the user fingerprint; partial-failure logged per device. |
| **v2.37** | Preference center API. `push_preferences(user, category, opted_out)` table; dispatch-time check; SDK `getPreferences / setPreferences`. API + table only — no hosted end-user UI (left to integrators). |
| **v2.38** | Queue model upgrade + horizontal workers. `SELECT ... FOR UPDATE SKIP LOCKED` (Pg 12+). Self-adaptive tick (busy / idle ratio). Optional Valkey hot queue. Multi-instance horizontal scaling. `push_sends + push_delivery_logs` audit log unchanged. |

## Out of scope (definitionally — not push subsystem)

The following are **not** deferred from the push roadmap; they are different product surfaces. If Sentori roadmap extends to any of them, each opens its own v3.x series (analogous to v3 GDS rewrite):

- **In-App Message overlay SDK / Inbox SDK** — product engagement / messaging UI.
- **Multi-channel orchestration (email + SMS + Slack)** — messaging orchestration.
- **Journey / workflow engine** — automation.
- **A/B variant testing** — experimentation.
- **Hosted end-user preference UI** — end-user portal (the API + table is in v2.37).

## License

Apache-2.0 OR MIT (matches Sentori monorepo). All code authored by GOLIA K.K.. The insight-push-server prior art is **referenced** only — design notes derived from reading its public source, no code copied. Sentori implementation is independently written.

## Related

- `docs/roadmap/v2.7.md` — phase 1 closeout
- `docs/roadmap/v2.8.md` … `v2.12.md` — subsequent phases (created when each starts)
- `docs/runbook/push-credentials.md` — operator runbook for APNs / FCM cred provisioning (created with v2.11 dashboard cred UI)
- `docs-site/recipes/push-from-api-route.md` — customer recipe (created with v2.8)
- `server/src/secrets.rs` — secret-encryption layer first user
