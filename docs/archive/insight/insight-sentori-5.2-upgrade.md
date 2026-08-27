# insight-mobile → Sentori SDK 5.2.0 upgrade (backend availability)

Audience: the insight-mobile team. Prerequisite: the 5.1 upgrade
(`insight-sentori-5.1-upgrade.md`). This one is the smallest yet:
a dependency bump and **one config line**. No native rebuild — 5.2
is JS-only over 5.1.x binaries.

## 0. What you get

Sentori starts monitoring **your backend's availability** and shows
it on the project card: a live status dot, 24h uptime %, and the
latest probe latency. The probing runs **server-side** (the Sentori
instance polls your health endpoint once a minute) — the app itself
never pings anything, so the client-zero-cost contract is untouched.

## 1. Bump — `package.json`

```diff
-    "@goliapkg/sentori-react-native": "^5.1.2",
+    "@goliapkg/sentori-react-native": "^5.2.0",
```

`bun install`, done. No other package moves, no pod/gradle step.

## 2. Config — one line in `sentori.ts`

```ts
init({
  // ...existing config...
  backendHealthUrl: 'https://api.your-backend.example/healthz',
})
```

Any URL your backend answers with a 2xx counts as healthy. The URL
rides along with the SDK's existing event batches (no extra
request); the server stores it once and probes it from its side
every minute with a 5-second timeout, user-agent
`sentori-backend-check`.

## 3. Verify (1 minute)

Open https://sentori.golia.jp → 项目 — within a couple of minutes
of the app sending any event, the insight-mobile card grows a
backend row: green dot, uptime %, latency. That row is the whole
feature.

## 4. Cost, for the record

Zero on-device: the URL is a string in an envelope the SDK was
already sending. All probing is Sentori-server → your backend
(1 request/min, 24h rolling retention).
