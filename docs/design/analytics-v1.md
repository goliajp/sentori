# Sentori analytics v1 — design proposal

Status: **DRAFT — for review, not yet broken into work units.**
Owner: claude + takagi
Date: 2026-05-19

## 1. Vision

Today Sentori is positioned as a debug / error-tracking platform: events, replay, breadcrumbs, traces. Users 2026-05-19 ask: **layer in product-analytics surfaces** so a single dashboard answers both "what's breaking" and "who's using what, where, on which devices, on which pages". Aim for Google Analytics / Firebase Analytics shape, **but kept fused with the existing debug tooling**, not bolted on as a separate product.

The differentiator vs vanilla GA: every analytics metric clicks through to the debug context that produced it.

- A spike on the "checkout" route in Indonesia → click into the same dashboard → see the active users on that route → click any of them → see their session's breadcrumb + replay timeline → click the error if one happened.
- Analytics is the *map*; debug is the *zoom*.

## 2. What we already collect

The SDK + server already gather most raw signals; analytics v1 is mostly a **rollup + dashboard** problem, not a new collection problem. Inventory:

| Signal | Source | Server table | Status |
|---|---|---|---|
| User id | `setUser({ id })` | `events.user.id` (denormalised) | ✅ |
| Anonymous flag | `setUser({ anonymous })` | embedded | ✅ |
| Device (os, version, model, locale, network) | auto | `events.device` | ✅ |
| Geo (country / region / city) | server-side IP lookup | `events.geo` | ✅ |
| Release / Bundle | auto | `events.release`, `events.bundle` | ✅ |
| Sessions (open / close / errored) | `session-tracker` | `events` kind=session | ✅ |
| Page / route (as breadcrumb) | `useTraceNavigation` | `events.breadcrumbs[*].type=='navigation'` | ✅ buried |
| Spans (perf + nav) | `@goliapkg/sentori-core` startSpan | `spans` table | ✅ |
| Custom metrics | `sentori.metric.gauge / counter / timing` | `metrics` table | ✅ |
| Custom events | (none) | — | ❌ missing |
| Active-user heartbeat | (none) | — | ❌ missing |

**Two real gaps**: live-presence pings and a first-class `sentori.track(event, props)` API. Everything else exists; we just don't roll it up.

## 3. Surfaces — what the dashboard ships

v1 adds three new pages plus deepens one existing detail page:

### 3.1 `Live` — concurrent users right now

Top-level metric: count of unique `user.id` (or anon `session.id` if anonymous) with a heartbeat in the last `90 s`.

Side-by-side breakdown cards:
- top 5 countries (with bars)
- top 5 devices (`iPhone 14 · iOS 17.4` etc.)
- top 5 routes (currently-on, derived from latest nav breadcrumb per active user)
- top 5 releases (proves the rollout health)

**Transport** (per `architecture-standards.md` §1–2):
- **Snapshot** at mount: `GET /admin/api/projects/{id}/live` → react-query L1 cache, persisted to L2 (localStorage / MMKV on RN dashboard) so reopen paints from cache within 20 ms.
- **Stream** in parallel: `GET /admin/api/projects/{id}/live:stream` (SSE) emits deltas `{kind: "presence.in" | "presence.out" | "dims.change", member, dims}` plus a periodic `heartbeat` keep-alive frame every 15 s. Client merges into the cached snapshot via `queryClient.setQueryData`.
- **Reconnect cursor**: SSE caries a `Last-Event-ID` header; on reconnect we re-snapshot if more than `WINDOW_MS / 2` elapsed since disconnect, else replay deltas from cursor.
- **Fallback**: chunk-A initial ship is T1 poll (5 s `refetchInterval`). T2 SSE upgrade lands in a follow-up sub-chunk; the snapshot endpoint stays the canonical L1 source. Both paths target the same `queryClient` slot so the swap is transparent to consumers.

Server keeps a Valkey sorted-set of `heartbeat_ts` per `user_id` + parallel HASH of dims, expires after `300 s`. Reads are O(log N + M) range queries. Writes coalesce ZADD + EXPIRE + HSET + EXPIRE via Lua script (atomicity + one RTT) — see `architecture-standards.md` §4.3.

### 3.2 `Audience` — DAU / WAU / MAU + dimension splits

Charts:
- Daily / weekly / monthly active users, last 90 days (sparkline + table)
- Stacked-area: DAU split by `device.os` / `release` / `country`
- Cohort retention: classic "users seen on day 0 → day N retention" matrix

Time-series storage: hourly rollups in a new `event_rollups_hourly` table (event_count, distinct_user_count, distinct_session_count, top-K dimensions). Hourly granularity bounds storage; UI re-aggregates to D/W/M on read.

### 3.3 `Behavior` — page / route flow

Charts:
- Top routes by visit count (last 24h / 7d / 30d toggle)
- Average dwell time per route (`spans` table — nav span duration — already there)
- Drop-off matrix: from each route, where do users go next? (compute from sequential navigation breadcrumbs per session)
- Custom events table: filter by `sentori.track('eventName', props)`

Implementation note: navigation breadcrumbs already capture `{from, to, ts}`. Aggregating into a session-scoped graph is a query, not new collection.

### 3.4 `User detail` — drill from any analytics row into a single user's timeline

Given `user.id` (or anon `session.id`), the page renders:
- All sessions for this user, latest first (open / errored / clean)
- Within a session: timeline of `nav → custom event → error → spans` interleaved by `ts`
- If session has a `replay` attachment, inline-mount the player
- Geo / device / release pinned at top
- "Open issue" links per error → goes to existing issue-detail

This is the *fusion* of analytics + debug: clicking a country bar in Audience → list of users in that country → user timeline → replay of their session → root-cause the dropoff.

Schema: an existing query, just a new view.

## 4. SDK additions (RN — also need JS/web parity later)

### 4.1 Heartbeat for live presence

```ts
// In session-tracker.ts, while AppState === 'active':
setInterval(() => {
  fetch(`${ingestUrl}/v1/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      sessionId,
      userId: getUser()?.id ?? null,
      release,
      ts: Date.now(),
      route: getLastRoute(),  // last navigation breadcrumb's `to`
    }),
  })
}, 60_000)   // 1 / minute foreground; nothing in background
```

Cost budget (per iron rule):
- 1 POST per minute foreground (negligible)
- Payload ~200 bytes (release + route + ts + ids)
- Drop / skip if last heartbeat < 30 s ago (e.g. AppState bounced)
- Foreground-only — never fires when user backgrounded the app

This is a **new** endpoint (`/v1/heartbeat`). Distinct from event ingest so we can rate-limit it separately and serve from a Valkey-only hot path.

### 4.2 Custom event API — `sentori.track(name, props)`

```ts
sentori.track('upsell.shown', { plan: 'pro', source: 'banner' })
```

Wire format: re-uses the existing event ingest endpoint with `kind: 'track'` (alongside the existing `kind: 'error' | 'session' | 'transaction'`). Server gets a new `events_kind = 'track'` partition; analytics rollups read both `error` and `track` for usage volume but they're queryable separately.

Per-call cost: same as captureException's transport — batched, debounced, retries.

### 4.3 Auto-instrument route view as a `track` event

When `useTraceNavigation` fires a navigation span, also emit `sentori.track('pageview', { from, to, duration })`. Lets the Behavior dashboard show route counts without re-implementing nav inference from breadcrumbs.

Toggle-able for apps that want explicit-only tracking.

## 5. Server side

### 5.1 New routes

| route | tier | purpose | body limit |
|---|---|---|---|
| `POST /v1/heartbeat` | T0 | live-presence ping | 1 KB (per-route) |
| `GET  /admin/api/projects/{id}/live` | T1 | concurrent-user snapshot | n/a |
| `GET  /admin/api/projects/{id}/live:stream` | T2 (SSE) | delta stream — `presence.in`, `presence.out`, `dims.change`, `heartbeat` | n/a |
| `GET  /admin/api/projects/{id}/audience` | T1 | DAU/WAU/MAU + dimensions | n/a |
| `GET  /admin/api/projects/{id}/behavior` | T1 | route counts, dwell, dropoff | n/a |
| `GET  /admin/api/projects/{id}/users/{userId}` | T1 | drill-down timeline | n/a |
| `GET  /admin/api/projects/{id}/users/{userId}:stream` | T2 (SSE) | append-only timeline events for the open user-detail page | n/a |

Tier semantics defined in `architecture-standards.md` §1.

### 5.2 New tables / structures

```sql
-- Hourly rollup. Truncate-and-rebuild on a schedule; cheap because
-- input is bounded by events arrival rate.
CREATE TABLE event_rollups_hourly (
  project_id     UUID NOT NULL,
  hour_ts        TIMESTAMPTZ NOT NULL,
  release        TEXT NOT NULL DEFAULT '',
  country        TEXT NOT NULL DEFAULT '',
  os             TEXT NOT NULL DEFAULT '',
  route          TEXT NOT NULL DEFAULT '',
  event_kind     TEXT NOT NULL,                 -- error / session / track / pageview
  event_count    BIGINT NOT NULL DEFAULT 0,
  distinct_users INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, hour_ts, release, country, os, route, event_kind)
);
CREATE INDEX ON event_rollups_hourly (project_id, hour_ts);
```

```redis
# Valkey — live presence
ZADD live:{project_id} <ts_ms> <user_id_or_session_id>
# Expire entries older than 120s on every read.
```

### 5.3 Rollup job

Cron / scheduler runs every 5 min, processes events newer than the last `hour_ts` watermark, batch-inserts into `event_rollups_hourly`. Lag tolerance ~10 min for the dashboard freshness.

## 5.4 Error shapes

Every non-2xx from analytics endpoints follows `architecture-standards.md` §5 exactly. Codes introduced for analytics:

| code | layer | meaning |
|---|---|---|
| `analytics.invalidWindow` | domain.analytics | `?since` cursor / time range bad |
| `analytics.projectInactive` | domain.analytics | project ingest disabled — live page shows degraded state |
| `analytics.streamLagged` | transport.sse | client cursor too old; client must re-snapshot |
| `analytics.rollupStale` | domain.analytics | last hourly rollup is >2h old; visible-but-degraded |

Each surface in the dashboard maps these to inline banners with `hint` + `correlationId` exposed.

## 6. Privacy

We're collecting more user-resolvable data → tighten the policy doc:

- Heartbeat carries the same `user.id` as events — caller's responsibility to use an opaque id (already PII-policy-validated).
- Geo at country granularity in the Live dashboard by default. Region/city only on drill-down.
- Anonymous mode (`setUser({ anonymous: true })`) still works — anon sessions count toward concurrent-user totals but never link to a user id.
- All rollups can be turned off project-wide with a new project setting `analytics.enabled = false`. Useful for purely-debug deployments.

## 7. Perf cost — per iron rule (CLAUDE.md)

### 7.1 SDK side

| Addition | Main-thread cost | Notes |
|---|---|---|
| Heartbeat 1/min | < 1 ms / min | fire-and-forget, foreground only |
| Auto pageview track | < 0.5 ms / nav | reuses existing nav span path |
| Custom `track` | < 0.5 ms / call | same shape as captureBreadcrumb |

All under the < 1 % main-thread occupation target.

### 7.2 Server side

| Path | p95 latency target | strategy |
|---|---|---|
| `POST /v1/heartbeat` | 8 ms | single Lua script doing ZADD+EXPIRE+HSET+EXPIRE atomically; no DB hit |
| `GET .../live` snapshot | 20 ms | ZRANGEBYSCORE + HMGET + in-process aggregate; no DB hit |
| `live:stream` SSE | 5 ms / delta | broadcast channel; one Valkey PUBSUB subscriber per project, multiplex deltas across all open dashboards |
| `audience` rollup read | 50 ms | Postgres rollup table indexed on `(project_id, hour_ts)`; pre-materialised |
| `behavior` flow | 100 ms | run-once per request; cache the result for 30 s in Valkey @ `behavior:<project>:<window>:<v>` |

### 7.3 Client cache strategy

Per `architecture-standards.md` §2 cache hierarchy:

| Surface | L0 (state) | L1 (react-query) | L2 (persistent) |
|---|---|---|---|
| Live | current snapshot + SSE-applied deltas | 5 s staleTime | yes (MMKV/localStorage) — paint from cache before snapshot lands |
| Audience | filter + range selectors | infinite staleTime, manual invalidate | yes — hourly rollups won't churn between page loads |
| Behavior | route filter | 60 s staleTime | yes |
| User detail | current scroll position | infinite staleTime | no (PII; don't persist) |

### 7.4 WASM opportunities (defer to measurement)

- Behavior flow's session-graph reconstruction (taking 1000 sessions × N navigation events into a Sankey-ready graph) could move to WASM if the audience grows past ~10 k sessions per request window. Measure first.
- Rollup write hot path is server-side; not a WASM target.

## 8. v1 scope vs later

| Feature | v1 | later |
|---|---|---|
| Live (concurrent users) | ✅ | — |
| Audience (DAU/WAU/MAU + splits) | ✅ | revenue tracking, ARPDAU |
| Behavior (route counts, dwell) | ✅ | funnels (multi-step conversion) |
| User detail timeline | ✅ | — |
| Heartbeat SDK | ✅ | — |
| `sentori.track` SDK | ✅ | — |
| Auto-pageview | ✅ | A/B test attribution |
| Cohort retention matrix | ✅ (basic) | cohort-builder UI |
| Funnels | ❌ | v2 |
| Real-time anomaly detection (e.g. "DAU dropped 20%") | ❌ | alerts integration |
| Cross-platform JS/web parity | ❌ for v1 | RN-first per project_direction |

## 9. Open questions

1. **Live page poll vs SSE.** 5 s poll is fine for ~100 dashboards open. SSE scales better but more infra. Decide based on expected dashboard concurrency.
2. **Anon retention** — without a stable `user.id`, returning users look new every install. Sentori today doesn't deduplicate. Do we need an opaque per-install fingerprint? Privacy implications.
3. **Storage cap** — hourly rollups grow as `projects × hours × cardinality`. For 100 projects × 90 days × ~5 dimensions × ~10 values each ≈ ~10 M rows. Fine for Postgres. Decide retention window.
4. **Dashboard nav** — Audience / Behavior / Live are three new sidebar entries. With Overview / Issues / Traces / Metrics / Vitals / Moments / Releases / etc., the sidebar is already dense. Group under a single "Analytics" expandable section? Or hoist to top-level?
5. **Pricing implications** — analytics-heavy projects pay differently from debug-only? Out of scope for design; flag for product.
6. **`sentori.track` event-name convention** — do we constrain like Sentry's `breadcrumb.category`, or let it be free-form like Firebase's `logEvent`? Free-form is simpler but harder to dashboard.

## 10. Suggested L2 break-down

If this direction is approved, v1 splits into ~4 shippable chunks:

| Chunk | Includes | Estimate |
|---|---|---|
| A. Heartbeat + Live page | new SDK heartbeat, `/v1/heartbeat` route, Valkey storage, Live dashboard | small |
| B. `sentori.track` + auto-pageview | SDK API, server `events_kind = 'track'`, ingest path | small |
| C. Hourly rollups + Audience page | scheduler, rollup table, Audience UI | medium |
| D. Behavior + User detail | route counts, dropoff, user timeline | medium |

A → B → C → D in dependency order. A and B unblock the rest.

## 11. Decisions needed before implementation

- ✅ / ❌ on the overall direction
- Pick a stance on open questions §9 (1)–(6)
- Confirm v1 scope §8 — anything to add / cut

Once these are settled, break L2 into hot/cold plans per CLAUDE.md's 4-layer planning rule and start chunk A.
