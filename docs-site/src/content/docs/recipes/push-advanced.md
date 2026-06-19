---
title: Push notifications — advanced features (v2.20+)
description: BI tags, confirmed-delivery ack, scheduled sends, topic pub-sub, user fanout, preference center, rich media, interactive actions, and the industrial-load guarantees Sentori's push subsystem grew over Phase 2 (v2.20–v2.36).
---

# Push notifications — advanced features (Phase 2)

This recipe covers everything Sentori's push subsystem grew between **v2.20 and v2.36**. v2.7–v2.19 shipped the foundation (5 providers, dashboard, JS / RN SDK); Phase 2 hardened it for industrial load and unlocked the wire-level features below.

If you're new to Sentori push, read [push-overview](./push-overview/) first.

## At a glance — what's new

| Feature | Version | Wire field | What it enables |
|---|---|---|---|
| Token cache + smart retry + send gate | v2.20 | (server-internal) | Won't get your APNs / FCM credentials blacklisted under heavy use |
| Per-provider connection + quarantine | v2.21 | (server-internal) | One bad project's APNs can't poison another's FCM |
| Three-layer rate limit | v2.22 | (server-internal) | L1 per-provider, L2 per-project, L3 global inflight |
| Invalid-token health + auto-throttle | v2.23 | (server-internal) | Sender reputation gauge with proactive throttle |
| Provider Health dashboard | v2.24 | GET `/admin/api/projects/:id/push/health` | "Distance to blacklist" gauge in dashboard |
| `_sentori.msgId` payload primitive | v2.25 | injected automatically | Server-to-SDK correlation handle |
| Campaign / template / audience BI tags | v2.25 | `campaignId`, `templateId`, `audienceTag` | Slice + filter sends in the dashboard |
| RN auto-correlation + ack | v2.26 | (SDK auto) + `POST /v1/push/sends/:id/ack` | `push` breadcrumb + `sentori.push.received/opened/dismissed` events + confirmed delivery |
| Downstream impact view | v2.27 | GET `/admin/api/projects/:id/push/sends/:id/downstream` | "What did this push cause?" in send-detail UI |
| Rich media (image) + iOS NSE template | v2.28 | `options.richMedia.imageUrl` | Android BigPicture auto-rendering + iOS NSE scaffold |
| Interactive actions | v2.29 | `options.actions[]` | Reply / dismiss buttons surfaced via `sentori_actions` |
| iOS interruption-level + thread-id + Android importance | v2.30 | `options.interruptionLevel`, `options.threadIdentifier`, `options.channelImportance` | OS-level urgency / grouping / priority |
| Topic pub-sub fanout | v2.31 | `to: { topic: "<name>" }` + topics endpoints | Send to all subscribers of a named topic |
| Scheduled sends | v2.32 | `sendAt: "<RFC3339>"` | Hold the send until a future timestamp |
| User-based publishing | v2.33 | `to: { userFingerprintHex: "<hex>" }` | Send to every device a user has registered |
| Preference center API | v2.34 | `preferenceCategory: "<name>"` + preferences endpoints | Per-(user, category) opt-out the dispatcher honors |
| `SKIP LOCKED` dispatch | v2.35 | (server-internal) | Multi-worker safe queue claim |
| Dashboard surfaces for above | v2.36 | (dashboard) | Ack badge, Campaign column, scheduled badge, BI tags Card, Delivery confirmation Card |

The rest of this page walks each user-visible feature with a wire example.

---

## BI tags (v2.25)

Tag any send with a `campaignId`, `templateId`, or `audienceTag` — free-text labels you define. They appear in the dashboard's Sends table (Campaign column) and on the send-detail "Campaign tags" card. Migration 0079 added the columns + index on `(project_id, campaign_id, created_at DESC)` for the typical "this campaign over time" query.

```bash
curl -X POST "$INGEST_URL/v1/push/send" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "ipt_abc123",
    "title": "Black Friday deal",
    "body": "30% off until midnight",
    "campaignId":  "blackfriday-2026",
    "templateId":  "deal-30pct",
    "audienceTag": "subscribers-us"
  }'
```

These columns are **write-only** as wire fields — they don't drive any provider behaviour. Their role is to let you cohort sends post-hoc in the dashboard and (future) in the `push_correlation` BI view.

---

## Confirmed delivery ack + `_sentori.msgId` correlation (v2.25 + v2.26)

The server **automatically** injects `_sentori.msgId = <send_id>` into every outgoing payload under `data._sentori.msgId`. Sentori RN SDK v2.26+ reads this on receive and:

1. Pushes a `{ type: 'push', data: { msgId, title, body, opened, provider } }` breadcrumb. A later `captureException` then carries this push in its breadcrumb trail.
2. Emits a tracked event (`sentori.push.received` / `sentori.push.opened` / `sentori.push.dismissed`) you can chart in the dashboard like any other tracked event.
3. Enqueues an ack POST to `/v1/push/sends/<msgId>/ack` — flushed every 5 s in the background. Server-side `push_sends.acked_at` flips on first ack.

You don't have to do anything host-app side. Upgrade the SDK and it just happens.

```ts
// Optional: pass the host's current session id so v2.27 correlation
// can JOIN on session_id.
import { sentori } from '@goliapkg/sentori-react-native'
sentori.push.setSessionContext(currentSession.id)
```

Legacy SDKs (pre-v2.26) ignore the unknown `_sentori` key — no breakage. The dashboard's send-detail view shows a "Delivery confirmation" card that explains why ack might be missing (pre-v2.26 client, host killed before 5 s flush, network drop).

---

## Downstream impact (v2.27)

In the dashboard's send-detail page, the **Downstream impact** card shows what happened in the 24 h after the push reached the device: event count, errors, distinct sessions, time-to-first-event.

It's a JOIN on `events_partitioned.payload->'breadcrumbs'` against the v2.25 msgId — pre-v2.25 sends (no msgId) show an "n/a" empty state instead of misleading zeros.

API: `GET /admin/api/projects/:projectId/push/sends/:sendId/downstream`.

---

## Rich media — image (v2.28)

```json
{
  "to": "ipt_abc123",
  "title": "Your order shipped",
  "body": "Track it →",
  "options": {
    "richMedia": { "imageUrl": "https://cdn.example.com/products/42.jpg" }
  }
}
```

- **Android (FCM)**: server writes `message.notification.image`. FCM **auto-renders** BigPicture style on the device with no host code needed.
- **iOS (APNs)**: server forces `aps.mutable-content: 1` and surfaces the URL under the reserved `sentori_attachment_url` custom-data key. A **Notification Service Extension** (NSE) on the device downloads + attaches the image before iOS displays. As of `@goliapkg/sentori-expo@7.0.2` the plugin **fully automates** NSE wiring — it writes the template to `ios/SentoriNSE/`, injects the Xcode target via `withXcodeProject`, and syncs the NSE Info.plist's `CFBundleShortVersionString` / `CFBundleVersion` to the host app's values so the `.appex` signs cleanly. No manual Xcode step. See the [iOS recipe](./push-from-react-native-ios/).
- **Web Push**: passes through under `data.sentori_attachment_url` so your Service Worker can use it as `options.image`.

---

## Interactive actions (v2.29)

```json
{
  "to": "ipt_abc123",
  "title": "Alex replied",
  "body": "Hey, do you have a minute?",
  "options": {
    "actions": [
      { "id": "REPLY",   "title": "Reply",   "isTextInput": true },
      { "id": "DISMISS", "title": "Dismiss" }
    ]
  }
}
```

The array surfaces under `sentori_actions` (top-level on APNs, JSON-stringified under `data` on FCM). Your host app reads it from the notification tap callback and dispatches per `actionId`. iOS `UNNotificationCategory` registration is still a host-app concern (Apple requires it at app launch).

---

## OS-level priority + grouping (v2.30)

| Field | Maps to | Effect |
|---|---|---|
| `options.interruptionLevel` (iOS 15+: `passive` / `active` / `timeSensitive` / `critical`) | `aps.interruption-level` | Quiet delivery vs Focus mode override |
| `options.threadIdentifier` | `aps.thread-id` | Group same-thread notifications on iOS lock screen |
| `options.channelImportance` (`high` / `default` / `low` / `min`) | FCM `message.android.notification.notification_priority` | Android channel priority hint |

All three are additive — omit them and behaviour is identical to pre-v2.30.

---

## Topic pub-sub (v2.31)

Subscribe a device to a topic:

```bash
curl -X POST "$INGEST_URL/v1/push/tokens/$IPT/topics" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "topic": "breaking-news" }'
```

Unsubscribe (idempotent):

```bash
curl -X DELETE "$INGEST_URL/v1/push/tokens/$IPT/topics/breaking-news" \
  -H "Authorization: Bearer $TOKEN"
```

Send to all subscribers:

```json
{
  "to": { "topic": "breaking-news" },
  "title": "Market open",
  "body": "Pre-market futures up 1.2%"
}
```

The server fans out to every active `device_tokens` row in your project subscribed to that topic. Zero subscribers returns an empty `tickets` array — no error.

---

## Scheduled sends (v2.32)

```json
{
  "to": "ipt_abc123",
  "title": "Daily digest",
  "body": "Your stats are ready",
  "sendAt": "2026-06-11T08:00:00Z"
}
```

`sendAt` is RFC3339. Past timestamps collapse to "send now". The dispatcher's existing `next_attempt_at <= now()` filter naturally holds the row until the time arrives — no extra cron complexity.

The dashboard's send-detail view shows a "⏰ scheduled" badge while the row is waiting.

---

## User-based publishing (v2.33)

Send to every device a user has registered:

```json
{
  "to": { "userFingerprintHex": "f1a2b3c4...32-byte-fp..." },
  "title": "Account update",
  "body": "Your new password is active"
}
```

The fingerprint is the value the SDK computes via `identity::compute_fingerprint(salt, key_type, linkHash)` when the host opts into [v2.3 identity linking](./../sdk-react-native/). The server hex-decodes, looks up matching `device_tokens.user_fingerprint_hex` in this project, and fans out one send per active device.

Empty user (no devices registered) returns an empty `tickets` array — no error. Malformed hex returns 400.

---

## Preference center (v2.34)

```bash
# Opt the user out of marketing for this project.
curl -X PUT "$INGEST_URL/v1/push/users/$FP_HEX/preferences/marketing" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{ "optedOut": true }'

# Read all preferences for a user.
curl "$INGEST_URL/v1/push/users/$FP_HEX/preferences" \
  -H "Authorization: Bearer $TOKEN"
# → { "preferences": [{ "category": "marketing", "optedOut": true }, ...] }
```

When a send has both `preferenceCategory` AND the recipient device has a `user_fingerprint_hex`, the dispatcher checks `push_preferences`. On `optedOut: true` it silently skips — the per-recipient ticket comes back `status: 'failed', providerOutcome: 'PreferenceOptedOut'` so the caller can audit, but no provider request happens.

```json
{
  "to": "ipt_abc123",
  "title": "Black Friday deal",
  "body": "30% off until midnight",
  "preferenceCategory": "marketing"
}
```

`preferenceCategory` is **distinct** from `options.category` — the latter is the iOS `aps.category` for action-button groups, the former is the end-user opt-out taxonomy you define (`marketing`, `billing`, `social`, etc.).

End-user UI is **out of scope** — the API + table give you the building blocks; wire them into your existing settings screen however you like.

---

## Anti-blacklist + multi-tenant guarantees

You don't have to opt in to any of this — it just runs:

- **Token cache** (v2.20). APNs JWT cached 20 min, FCM/HCM OAuth tokens cached `expires_in - 60s`, VAPID JWT cached 11 h. Won't trip APNs's `TooManyProviderTokenUpdates`.
- **Smart retry** (v2.20). PermanentlyInvalidToken → don't retry. 429 with `Retry-After` → honour exactly. Transient → exponential ladder `[60s, 5m, 30m, 2h, 12h, 24h]` with ±20% jitter.
- **Send-API gate** (v2.20). Per-token 60/min, per-batch 100 recipients, payload 4032 B (4 KiB minus headroom for the `_sentori.msgId` injection). Bad input gets a structured 400 / 429 instead of corrupting your retry queue.
- **Per-provider connection isolation** (v2.21). Each provider has its own `reqwest::Client` with tuned pool/idle. APNs gets 90 s idle to honour Apple's "single persistent HTTP/2 connection" guidance.
- **5xx-streak quarantine** (v2.21). 5 consecutive transient failures → `(project, provider)` parked for 60 s. Sends to a quarantined target are deferred without burning retry budget.
- **Three-layer rate limit** (v2.22). L1 per-provider token bucket, L2 per-project quota, L3 global inflight cap. Layer-specific defer windows; permits drop automatically on completion.
- **Invalid-token health + auto-throttle** (v2.23). Rolling 5-minute invalid-rate per `(project, provider)`. ≥10% invalid AND ≥20 in-window → auto-throttle warning emitted, dashboard shows "distance to blacklist" gauge.
- **Stale-token soft eviction** (v2.23). Tokens whose `last_seen_at` is > 90 days old are silently skipped at dispatch (almost certainly OS-revoked).
- **`SKIP LOCKED` claim** (v2.35). Multiple dispatcher workers can sweep the queue concurrently without double-dispatching.

The full state — quarantine, rate-limit, health — is in-memory per process. v2.38 (future) will optionally share via Valkey for horizontally-scaled deployments. Until then the single lx64 instance is the deployment.

---

## Where to look in the dashboard

| What you want | Where |
|---|---|
| "Is my push reaching the device?" | Sends tab — new **Ack** column (✓/—). Empty Ack on a sent row = SDK didn't post the ack. |
| "Why didn't this user get the push?" | Send detail — Delivery confirmation card explains. |
| "How is this campaign performing?" | Sends tab filtered to your `campaignId` (Campaign column shows the tag). |
| "Is my sender at risk of FCM/APNs blacklist?" | Push tab → Overview → Provider Health card, "safety margin" gauge. |
| "What did this push cause?" | Send detail → Downstream impact card. |

---

## Migrations

Phase 2 added four nullable migrations — all backward-compatible:

- `0079_push_sends_campaign_audience.sql` — campaign / template / audience tags
- `0080_push_sends_ack.sql` — `acked_at` + `ack_session_id`
- `0081_device_topics.sql` — `device_topics` table + topic index
- `0082_push_preferences.sql` — `push_preferences` PK `(project, fp, category)`

Pre-Phase-2 rows stay NULL; no backfill needed.

## Notes for hosts running companion config plugins

If you write your own Expo config plugins next to `@goliapkg/sentori-expo` (custom `withDangerousMod` / `withInfoPlist` / `withEntitlementsPlist` mods), two behaviours are worth knowing:

- **`dangerousMod` callbacks run LIFO**, not in plugin-registration order. The last-registered plugin's `dangerousMod` runs first. If your mod expects the `ios/SentoriNSE/` directory to exist (e.g. a follow-up file rewrite), register your plugin **before** `@goliapkg/sentori-expo` in `plugins` so its mod runs after sentori's template copy.
- **`withSentoriPushIos` guards are "first writer wins"**, not "sentori wins". Sentori only sets `UIBackgroundModes ⊇ ['remote-notification']` and `aps-environment` when those keys aren't already present. If you're co-existing with `expo-notifications` or another push plugin that sets these, the value of the plugin that ran last is what ends up on disk.

## See also

- [push-overview](./push-overview/) — the original "how Sentori push works" map
- [push-from-react-native-ios](./push-from-react-native-ios/) — iOS-specific recipe (now including NSE setup)
- [push-from-react-native-android](./push-from-react-native-android/) — Android-specific
- [push-from-nextjs](./push-from-nextjs/) — Web Push from a Next.js server
- `docs/design/push-architecture.md` — frozen architecture + four ironclad rules (in the repo)
