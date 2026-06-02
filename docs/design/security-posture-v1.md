# Sentori security posture v1 — design proposal

Status: **DRAFT — for review, not yet broken into work units.**
Companion to `analytics-v1.md`; sits as the next-major design after analytics-v1 chunk A.
Owner: claude + takagi
Date: 2026-05-19

## 1. Vision

Mobile-app cert pinning today is **binary**: pin matches → request flies; pin mismatches → SDK blocks the request and the user often gets a hard error they can't recover from. The pin can mismatch for at least four very different reasons:

1. **Real MITM attack** — adversary terminated the TLS connection.
2. **Corporate proxy / firewall** — many enterprise networks legitimately MITM all egress with their own root CA installed on managed devices.
3. **Captive portal** — coffee-shop / airport intermediate page redirects the first request, returns its own cert.
4. **Operator mis-configuration** — the host app shipped with a stale pin and the real backend rotated.

Of those, only (1) deserves a hard block. (2), (3), (4) want graceful degradation: warn the user, log it, escalate if the same device sees more anomalies later. Today's binary verdict treats all four the same.

Sentori's role in zero-trust: **collect a richer signal set, score each request's trustworthiness on a continuous axis, and surface the score back to the host SDK so it can decide rather than reflexively block**. Same posture for any auth / risk decision the host app makes — login from new device, sensitive transfer, biometric step-up — not just cert pinning.

This is the **third leg** of sentori's product stance:
- Debug = "what went wrong"
- Analytics = "who's using what" (chunk-A live, chunks B-D filling out)
- **Security posture** = "should this request be trusted right now"

All three share the same identity / device data already in the events pipeline, so the SDK addition is tiny compared to the new surface.

## 2. Identity model — `user @ env @ project` and federated lift

The triple `(project_id, environment, user_id)` is the primary scope for trust accumulation. Within one app environment of one project, a stable user.id earns a stable trust profile.

Two additional layers above:

- **Federated user**. When sentori knows the user came in through OAuth (`oauth_provider, oauth_subject` already on the `users` table per migration 0044), we can link `user_id` rows across projects under the same org. A Google-account user who registered in two projects gets one federated identity; their trust profile aggregates across both.
- **Device fingerprint**. Below the user, the device itself is a stable entity. Sentori today tracks `device.{os, osVersion, model, locale, networkType}` and `bundle.id` per event. A first-party `installId` (UUID generated once on first app launch, persisted to AsyncStorage / Keychain) anchors the device as a stable entity even for anonymous users.

```
  ┌────────────────────────────────────────────────┐
  │  FEDERATED USER                                │
  │  (oauth_provider, oauth_subject)               │
  │  ─ trust aggregate across all linked accts ─   │
  └──────────────────────┬─────────────────────────┘
                         │ many-to-one
  ┌──────────────────────▼─────────────────────────┐
  │  USER @ ENV @ PROJECT  (primary scope)         │
  │  (project_id, environment, user_id)            │
  │  ─ per-app trust profile lives here ─          │
  └──────────────────────┬─────────────────────────┘
                         │ many-to-one
  ┌──────────────────────▼─────────────────────────┐
  │  DEVICE @ USER                                 │
  │  (user_id, install_id)                         │
  │  ─ stable across reinstalls if Keychain held ─ │
  └────────────────────────────────────────────────┘
```

The dashboard renders trace lookups at any of three levels:
- "All activity for `oauth/google:sub-1234`" → cross-project view
- "Activity for `user-id-foo` in `project-A:prod`" → per-app view
- "Activity for `install-id-xyz` across users" → device shared between accounts

## 3. Signal set

The SDK ships these alongside each event today (no new collection):
- `device.{os, osVersion, model, locale, networkType}`
- `user.id` (when `setUser` called) / anonymous flag
- `release`, `bundle.id`, `environment`, `project_id`
- `geo.{country, region, city}` (server adds from IP)
- Breadcrumbs (network / nav / custom)

**New signals to add** (small SDK surface, per iron rule):

| Signal | SDK side | Server side | Cost |
|---|---|---|---|
| `installId` (UUID, persisted to Keychain / AsyncStorage) | new — one-time on first launch | event field | trivial |
| `tls.fingerprint` — JA3 hash of the client's TLS handshake | best-effort native helper | event field | ~50 µs / capture |
| `cert.pin` event — pin matched / mismatched / corp-CA-detected | new `sentori.reportSecurity(kind, data)` API | new `events.kind = 'security'` partition | < 1 ms / call (opt-in path) |
| Network ASN | server-side IP→ASN lookup (extend geoip) | event field | < 0.1 ms / event |
| `bundle.signed_by` — code-signing identity / Google Play signer | native helper, one read at start | startup event field | one-time |

## 4. Trust score model

Compose a continuous **trust score** `s ∈ [0, 1]` per request from weighted signals. Each signal contributes a delta against a per-(scope)-baseline. The signal pipeline is intentionally **declarative**: a rule set the operator can read, audit, and tune.

```
trust(req) = sigmoid( Σ_i w_i · f_i(req) )

where each f_i ∈ [-1, +1]:
  +1 strongly trustworthy
  -1 strongly anomalous
   0 neutral / unknown
```

Initial signal contributors:

| Signal | Contribution shape | Default weight |
|---|---|---|
| `device.installId` matches the user's historical device set | +1 if known, 0 if new install last 7 d, −0.3 if first-ever for this user | 1.0 |
| `geo.country` matches user's top-3 historical countries | +0.7 / +0.0 / −0.5 / −1.0 (sliding) | 0.7 |
| `tls.fingerprint` matches the user's top-3 historical handshakes | +0.5 / 0 / −0.5 | 0.4 |
| `network.asn` matches user's top-3 historical ASNs | +0.3 / 0 / −0.3 | 0.3 |
| `cert.pin` status (per request, when known) | +1 = match, 0 = corp-CA detected, −0.8 = mismatch with no other signal, −1 = mismatch + anomaly elsewhere | 1.5 (heaviest) |
| `velocity` — events/minute outside user's typical band | 0 / −0.5 / −1 by sigmoid on z-score | 0.5 |
| `recency` — time-since-last-active (off for an active session) | 0 (recent) / −0.2 (gone for > 30 days) | 0.2 |

Scores cluster:
- `>= 0.85` → **trusted**: serve as-is, no friction
- `0.5–0.85` → **soft challenge**: allow but require an extra factor on sensitive ops (re-auth, biometric, OTP)
- `0.2–0.5` → **hard challenge**: block sensitive ops, allow read-only
- `< 0.2` → **block**: emit security event, surface in dashboard, host SDK should treat as compromised

Weights are configurable per project at first, per env later. v1 ships sane defaults.

## 4.1 Score caching + delta sync

Trust scores can update mid-session (a new signal landed: pin mismatch, ASN flip, etc.). Naive polling burns network for nothing changing 99 % of the time; naive query-on-every-call blocks the host's hot path. Solve via the cache + stream contract from `architecture-standards.md` §1–2:

- **L1 (in-process)**: latest score per `(project, env, user)` cached in JS for 30 s.
- **L2 (persistent)**: same score persisted to MMKV / Keychain (SDK) so a cold app launch shows the last-known score within 5 ms.
- **Server T2 stream** `GET /v1/security/score:stream` — long-lived SSE per session. Emits a delta `{score, reasons[], delta_signals[]}` whenever the server-side aggregator re-evaluates (debounced 1 s after any new signal lands). Client updates L1 + L2 without firing another HTTP request.
- **Server T1 snapshot** `GET /v1/security/score` — used on cold start / after a long disconnect; returns the current value + a stream cursor so the stream resume picks up cleanly.

Net effect: in steady state the host SDK reads from L1 with 0-cost; the server proactively pushes updates when material change happens. The "query before sensitive op" call becomes `await sdk.queryTrustScore({ for: 'transfer' })` which checks L1 → returns ≤ 1 ms.

## 5. SDK API additions

Two new surfaces on top of the existing one:

```ts
// Report any security-relevant moment. Host app decides what to call,
// sentori scores + persists + dashboards it.
sentori.reportSecurity('cert.pin.mismatch', {
  expected: 'sha256/AAAA...',
  observed: 'sha256/BBBB...',
  serverName: 'api.host.tld',
  // optional caller-provided extras
  tags: { endpoint: '/v1/wallet', risk: 'medium' },
})

// Query the current trust score for the calling session. Returns
// cached result if last refresh < 30 s; otherwise a network call.
const verdict = await sentori.queryTrustScore({
  // optional context shaping the score (the server combines with the
  // installed signal set):
  for: 'cert.pin.mismatch',
  // host wants the explanation surfaced too
  withReasons: true,
})
// verdict.score    → 0..1
// verdict.action   → 'allow' | 'soft_challenge' | 'hard_challenge' | 'block'
// verdict.reasons  → [{ signal: 'geo.country', delta: -0.5, value: 'JP' }, …]
```

Both calls are auth'd via the existing ingest token. No new endpoint shape, the routes just sit at `/v1/security/report` and `/v1/security/score`.

`reportSecurity` is fire-and-forget. `queryTrustScore` is the one place we let the SDK block — but it caches aggressively (30 s) and falls back to "allow" if Sentori is unreachable (fail-open), so host apps don't break when sentori is down.

## 6. Server data model

Two new tables (sketch):

```sql
-- The accumulated trust profile per (project, env, user).
CREATE TABLE trust_profiles (
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  install_id      TEXT,            -- when known
  last_score      REAL NOT NULL DEFAULT 1.0,
  last_score_at   TIMESTAMPTZ NOT NULL,
  -- compact histograms for the score function — JSON keeps schema
  -- additions cheap as we tune signal coverage
  signal_history  JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (project_id, environment, user_id)
);

-- Append-only log of security events (pin mismatches, score queries,
-- step-up challenges fired, etc.). Drives the dashboard timeline.
CREATE TABLE security_events (
  id              UUID NOT NULL PRIMARY KEY,
  project_id      UUID NOT NULL,
  environment     TEXT NOT NULL,
  user_id         TEXT,
  install_id      TEXT,
  kind            TEXT NOT NULL,   -- 'cert.pin.mismatch', 'score.query', 'challenge.fired', etc.
  trust_score     REAL,            -- score at time of event, if applicable
  action          TEXT,            -- the policy verdict
  payload         JSONB NOT NULL,  -- caller-provided + server-augmented
  occurred_at     TIMESTAMPTZ NOT NULL,
  ip              INET,
  geo_country     TEXT,
  geo_region      TEXT,
  asn             INT,
  tls_fingerprint TEXT
);
CREATE INDEX ON security_events (project_id, occurred_at DESC);
CREATE INDEX ON security_events (user_id, occurred_at DESC);
CREATE INDEX ON security_events (install_id, occurred_at DESC);
```

Federated linkage:

```sql
-- Optional join from a project-local user_id to a federated identity.
CREATE TABLE user_federation_links (
  project_id      UUID NOT NULL,
  user_id         TEXT NOT NULL,
  oauth_provider  TEXT NOT NULL,
  oauth_subject   TEXT NOT NULL,
  linked_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX ON user_federation_links (oauth_provider, oauth_subject);
```

The dashboard's cross-project view joins on `(oauth_provider, oauth_subject)` to gather every linked `(project_id, user_id)` and then unions their security_events.

## 7. Dashboard surfaces

New top-level sidebar entry `Security` (Monitor group), with three views:

- **Posture**. List of users sorted by lowest current trust score. Click → user-detail timeline of security_events. Cross-project pill when the user is federated.
- **Pin anomalies**. Map view of cert-pin mismatch events by geo. Each marker clickable → list of users affected, expected vs observed pin, ASN. Highlights mass-mismatch clusters (signal of a real MITM campaign).
- **Trust signal explorer**. For each weight in the score function, show its distribution on real traffic + a tunable slider. Operator can sandbox-tune weights against historical data before rolling out.

The existing `Cert monitor` module (CT log polling) stays — it answers "have new certs been issued for *our* domains" — a complementary product surface, not the same thing.

## 8. Privacy

Trust scoring uses signals that overlap with PII risk:
- `installId` is a stable device identifier — must be obviously documented, and host apps should treat it as PII for compliance.
- TLS JA3 fingerprint is mildly identifying.
- ASN history could expose home / corp network patterns.

Policy:
- Project setting `security.enabled = false` opts out wholesale; SDK never collects new signals.
- `installId` is hashed (HMAC-SHA256 over org-scoped secret) before storage, so even server breach doesn't yield raw device ids.
- TLS fingerprints similarly hashed.
- Federation linkage requires explicit opt-in per org.

This matches the existing `privacy_lab` posture — we surface findings transparently and the operator controls retention.

## 9. Perf cost — iron rule

### 9.1 SDK side

| Addition | Main thread cost | Network |
|---|---|---|
| `installId` first-launch read | ~0.5 ms once | none |
| `sentori.reportSecurity()` call | ~0.3 ms (event ingest path) | shares ingest batch |
| `sentori.queryTrustScore()` cold | ~50 ms | 1 request, ~1 KB body |
| `sentori.queryTrustScore()` L1 hit | < 1 ms | none |
| `sentori.queryTrustScore()` L2 hit (cold launch) | ~3 ms | none |
| SSE score-stream backplane | < 1 ms / delta | long-lived conn, 1 KB / push |
| Server-side score compute | ~5–10 ms / score | none |
| Server-side install_id hashing | < 1 ms | none |

All host-side adds are < 1 % main-thread occupation. SDK caches L1/L2 per `architecture-standards.md` §2; **steady-state queries hit L1 with zero network**. Fail-open if Sentori is unreachable, so a temporarily-down sentori doesn't lock users out.

### 9.2 Server side

| Path | p95 latency target | strategy |
|---|---|---|
| `POST /v1/security/report` | 5 ms | append-only insert; signal aggregator picks up async (1 s debounce per scope) |
| `GET /v1/security/score` snapshot | 10 ms | hot path reads `trust:<project>:<env>:<user>` Valkey hash (Lua script for atomicity); falls through to Postgres on miss |
| `GET /v1/security/score:stream` SSE | 1 ms / push | broadcast channel scoped to the score-changes per project; multiplex out to all dashboards + SDK consumers |
| Posture page (top N low-trust users) | 100 ms | materialised hourly into `trust_lowest_users:<project>` Valkey ZSET |
| Pin-anomaly map | 200 ms | aggregate Postgres `security_events` over the last 24 h, cache 60 s in Valkey |

### 9.3 Cache strategy

| Surface | L0 | L1 react-query | L2 persistent | L3 Valkey | L4 Postgres |
|---|---|---|---|---|---|
| Trust score in SDK | — | — | MMKV / Keychain (5 min) | `trust:<...>` hash (24 h) | profile table |
| Posture dashboard | filter | 30 s stale | localStorage (5 MB cap) | `trust_lowest_users:<p>` (1 h) | profile table |
| Pin anomaly map | viewport | 60 s stale | localStorage | `pin_anomalies:<p>:24h` (60 s) | security_events |
| Signal explorer | weight sliders | infinite stale; manual invalidate | localStorage | none | weights table |

### 9.4 WASM opportunities

- **IP→ASN lookup**: ships with a ~5 MB MaxMind-format database. WASM-side resolution at < 100 µs. Worth it because every security event runs through it.
- **Trust score recompute** (when sliders move on the signal explorer): replay historical events through the candidate weight set client-side. WASM lets us do 50 k events in ~50 ms; the same in JS is ~400 ms.

## 9.5 Error shapes

Per `architecture-standards.md` §5 — every security endpoint returns the structured error body. Codes introduced:

| code | layer | meaning / hint |
|---|---|---|
| `security.notLinked` | domain.security | user_id has no federation link; cross-project query returns scoped data only |
| `security.scoreUnavailable` | domain.security | not enough signal history for a confident score (cold-start window); SDK should treat as `score=0.5, action='allow'` |
| `security.weightVersionStale` | domain.security | dashboard sent a write against an older weight version; reload and retry |
| `security.signalRejected` | domain.security | submitted signal failed validation (oversized payload, unknown kind); details in `hint` |

SDK exception classes:
- `SentoriSecurityReportError` — `reportSecurity()` failed to upload. Best-effort by design; never thrown to host code, only logged in `__DEV__`.
- `SentoriTrustQueryError` — `queryTrustScore()` failed AND L1/L2 cache was also empty. Host should treat as fail-open. Carries `code` + `correlationId`.

## 10. v1 scope vs later

| Feature | v1 | later |
|---|---|---|
| `installId` SDK | ✅ | — |
| `sentori.reportSecurity()` API + ingest | ✅ | — |
| `sentori.queryTrustScore()` API + scoring | ✅ basic 6-signal weighted sum | learned weights from labelled history |
| Posture dashboard | ✅ | — |
| Pin-anomaly map | ✅ | clustering / attribution |
| Trust signal explorer | ✅ basic distributions | what-if simulator over historical traffic |
| Federation linkage table + cross-project trace | ✅ | merge UI (operator-approved manual link) |
| TLS JA3 fingerprint capture | ❌ (needs native) | v1.x |
| ASN history | ✅ from server-side IP→ASN | |
| Step-up challenge orchestration (host SDK ↔ sentori) | ❌ | v2 |
| Adversarial detection (botnet clusters, credential-stuffing) | ❌ | v2 |
| MFA / WebAuthn integration | ❌ | v2 |

## 11. Open questions

1. **Score interpretation surfaced to end users?** Default is "host SDK consumes the score, end-user never sees it". Some operators may want to surface "you're signed in from a new device — confirm" UX directly. Standardise the wording or leave to host?
2. **Federation auto-link or manual?** Sentori has `oauth_provider, oauth_subject` on the users table, but linking SDK-side `user_id` to a federated identity requires either the host to call `sentori.linkFederatedIdentity({ provider, subject, userId })` after OAuth, or sentori to infer (e.g. from the host's OAuth token forwarded for verification). Inference is heavier and depends on host trust; explicit link is cleaner.
3. **Weight tuning UX**. The signal explorer shows current weights; should the operator be able to ship weight changes hot, or must they go through a version-bump on the project's risk policy? Hot is faster but auditable changes matter.
4. **Score cache TTL**. 30 s is the SDK default; aggressive (5 s) gives faster reaction to anomalies but more network. Per-project tunable, or fixed?
5. **`installId` durability across reinstalls**. iOS Keychain entries survive uninstall by default; Android shared prefs don't. Keychain on iOS + a Tink-encrypted blob in Android Keystore probably gets us 95 % cross-reinstall stability. Worth the SDK complexity?
6. **GDPR / CCPA "delete my data"**. We have to plumb through deletion across `security_events`, `trust_profiles`, `user_federation_links`. Should align with the existing privacy_lab pipeline.

## 12. Suggested L2 break-down

If approved, v1 splits into 4 chunks (echoing analytics-v1's shape):

| Chunk | Includes | Estimate |
|---|---|---|
| S1. `installId` + signal collection | SDK adds installId, ingest stores it; server ASN lookup on the existing geoip pipeline | small |
| S2. `reportSecurity` + Pin-anomaly dashboard | SDK API, `events.kind = 'security'`, dashboard map | medium |
| S3. Scoring engine + `queryTrustScore` | weighted sum, Posture dashboard, signal explorer | medium |
| S4. Federation linkage + cross-project trace | linkage table, dashboard joining view, deletion plumbing | medium |

S1 → S2 → S3 → S4 in dependency order. S3 is the centerpiece; S1+S2 fill the data; S4 is the multi-project wow.

## 13. Decisions needed before implementation

- Direction ✅ / ❌
- Stance on open questions §11
- Confirm v1 scope §10

Once those land, break out the four S-chunks into hot/cold plans per CLAUDE.md and start S1.
