# Sentori architecture standards — v1 platform disciplines

Status: **DRAFT — cross-cutting standards every v1 feature must apply.**
Companion to `analytics-v1.md`, `security-posture-v1.md`, and any future feature design.
Owner: claude + takagi
Date: 2026-05-19

## 0. Why this doc exists

Sentori is positioned as an **极专业** debug+analytics+security platform. "Professional" here is a load-bearing word: it means the parts of the system the user *doesn't* see still feel deliberate — latencies are budgeted, caches are layered, errors carry actionable context, code quality is enforced. Three feature buckets (debug / analytics / security) will accrete fast; without shared discipline they will drift apart in idioms and the platform will read as a stitched-together collection of MVPs instead of one product.

This doc codifies the cross-cutting rules. Every future feature design references it instead of reinventing the transport / cache / error story.

## 1. Transport tier — pick by signal shape, not by habit

Four tiers, each with a typical latency / load profile. Pick the lowest tier that meets the signal's freshness requirement.

| Tier | Mechanism | Freshness | Cost | When to use |
|---|---|---|---|---|
| **T0 — one-shot** | `fetch()` from client, react-query default `staleTime: Infinity` | hours / on-demand | trivial | static config, releases list, project metadata |
| **T1 — interval poll** | react-query `refetchInterval` | 5–60 s | low (1 req/window/client) | counts / metrics that change slowly; small dashboards |
| **T2 — SSE subscribe** | `EventSource`, append-only stream | 0–1 s | medium (long-lived conn) | append-only event ticks, log tails, replay events |
| **T3 — WS bidi** | `WebSocket` over `wss://` | 0–500 ms | medium-high | live-debug step-through, collaborative editing, score-query that needs server-push invalidation |

**Rule**: any feature whose UI is a *trend over time* defaults to T1 (poll) until either dashboard concurrency exceeds 100 *or* freshness requirement drops below 2 s. Anything **append-only and order-preserving** defaults to T2 (SSE) — clients reconnect cheaply, replay missed messages via cursor. Anything **bi-directional** (server can push invalidations, client can send commands) is T3 (WS).

Sentori's existing `/v1/events:stream` (Phase 50 sub-A1) is already T2. Future analytics Live page, security pin-anomaly map, etc. follow the same pattern.

### Delta-only payloads

Every T2/T3 stream is **delta-encoded** against a baseline. The client subscribes with a cursor (`?since=<last_event_id>` or message-frame ack), server replays from the cursor. Snapshot endpoints (T0/T1) accompany the stream — the client fetches once on mount, then keeps the local state synced via the stream. We already do this shape in `replay-encoding-v2` (keyframe + delta NDJSON). Generalise:

```
1. Client mounts → GET /snapshot      → big baseline
2. Client connects → SSE /stream      → small deltas, applied to baseline
3. Disconnect / reconnect → GET /snapshot again from last cursor, then resume stream
```

The dashboard uses `react-query`'s queryClient to materialise the snapshot, then a stream handler that calls `queryClient.setQueryData` to apply each delta. The query key remains stable across snapshot+delta, so React re-renders trigger off the same state cell.

## 2. Client cache hierarchy

Five layers. The client always reads from L0 first and walks down on miss.

```
L0  React state (in-memory, current render scope)
L1  react-query cache (in-memory, cross-component, observed by useQuery)
L2  Persistent local store
        - RN SDK + RN dashboard: MMKV
        - Web dashboard: localStorage / IndexedDB
        - Web Worker scope: Cache API
L3  Server-side Valkey / KV (per-project hot data, sub-ms reads)
L4  Postgres (cold authoritative store)
```

### Rules

- **Always provide a stale-while-revalidate path**. react-query's `staleTime` + `refetchOnWindowFocus` is the default; pair with L2 for *initial paint* — `react-query` rehydrates from MMKV / localStorage before the server ever responds.
- **Persistent store key naming**: `sentori:<scope>:<feature>:<v>` (e.g. `sentori:org:GOLIA:live:v1`). Versioned so a schema change invalidates safely.
- **Eviction discipline**: L2 caps at 5 MB total per origin. Each feature owns ≤ 1 MB of L2 and self-evicts oldest-first.
- **Don't persist secrets**: tokens stay in HttpOnly cookies. L2 only ever holds non-secret data.
- **Server-side L3**: every Valkey key MUST carry a TTL. Implicit-TTL is a code-review reject.

### Worked example — Live page

```
Page mount:
  - useQuery('live', {snapshot}) — react-query hits L1 (miss) → L2 (MMKV/localStorage) → painted
  - Same query fires a parallel SSE to /v1/projects/<id>/live:stream with cursor
  - SSE deltas → queryClient.setQueryData('live', applyDelta)
  - On unmount: queryClient persists current state to L2 (debounced 1 s)

Worst case (cold cache, server slow):
  - L0/L1/L2 all miss, fetch baseline → 50 ms
  - SSE subscribes in parallel
  - First paint waits for L1 only; loading state at the row level

Best case (warm cache, hot reload):
  - L2 hydrates → first paint immediate
  - Stream catches up missed deltas via cursor
  - User sees stale-but-credible data within 0 ms, fresh within ~500 ms
```

## 3. WASM use cases

WASM is the right tool when the work is **CPU-bound, isolatable, ≥ 100 ms in plain JS, and runs in a context where the user notices the stall**. Three concrete sentori use cases:

1. **Wireframe replay reconstruction** (already in flight). Reconstructing the timeline from 60 s of keyframe+delta NDJSON at 24 fps render means parsing JSON, applying diffs, materialising state on every frame. Plain JS works for the dev panel scale (~30 nodes), starts to wobble around 200 nodes per frame. A small Rust→WASM module that ingests the raw NDJSON byte stream and exposes `reconstructAt(ts)` over the JS↔WASM boundary cuts the per-frame cost in half.
2. **Trace span tree assembly** on the trace detail page. Today we walk `spans[]` and build a parent-child map in JS each render. For 5 000-span traces this is noticeable. WASM-side once → JS reads the materialised tree → React renders.
3. **Geo/IP routing** for the security posture's signal computation, when we eventually run scoring client-side (e.g. for SDK self-check before phoning home). WASM ships the IP→ASN database and resolves in 50 µs.

**Anti-pattern**: do NOT WASM-ify code that's already < 10 ms or that's IO-bound. JS→WASM boundary crossing costs ~5 µs/call; spending it on cheap work is worse than not bothering. Each WASM module must justify its existence with a measurement.

## 4. Valkey discipline (server hot path)

Sentori already uses Valkey for rate limits, recent-events ring, quotas, and (analytics v1) live presence. Establish a single house style.

### 4.1 Key naming

```
<feature>:<scope>[:<sub-scope>]:<v>
  ^^^^^^^^^                 ^
  | feature group           | schema version

Examples:
  live:<project_uuid>                       (zset, presence)
  live:<project_uuid>:dims                  (hash, presence dims)
  ratelimit:<token_hash>:<minute_bucket>    (counter)
  trust:<project_uuid>:<env>:<user_id>      (hash, security posture)
```

- Lower-case, colon-delimited, no `_` (kebab-only inside a segment).
- Schema version on the *feature* prefix only when we need parallel-write migration; otherwise the value is JSON-shaped and self-describing.

### 4.2 TTL is mandatory

Every `SET` / `ZADD` / `HSET` writes a `EXPIRE` immediately. There is no key without a TTL. We pick a TTL category per feature:

| Category | Default TTL | Examples |
|---|---|---|
| Hot session | 300 s | live presence, current trust score cache |
| Rate-limit window | 70 s | per-token / per-IP buckets |
| Materialised aggregate | 1 h | hourly rollups feeding dashboards |
| Idempotency / dedup | 24 h | event-id dedup keys |
| Pre-computed hot | 7 d | release artifact metadata |

If a feature needs persistence beyond hot, it lives in Postgres, not Valkey. Valkey is the cache, not the source of truth.

### 4.3 Pipelining + Lua

Multi-step writes that need atomicity → Lua script. Multi-step writes that don't → pipeline. Never sequence Round-Trip-after-Round-Trip in user-blocking paths.

Existing examples to extract patterns from:
- `rate_limit.rs` uses INCR + EXPIRE pipelining (good).
- `live_presence::register` does ZADD + EXPIRE + HSET + EXPIRE four-call (acceptable now; pipeline when it shows up in flame).

### 4.4 Failure mode = fail-open

Every Valkey-backed code path has a fail-open branch when the connection manager errors:
- Heartbeat: drop the call silently. Best-effort signal.
- Rate-limit: allow the request. Better to over-serve than 503 on transient Valkey blip.
- Live snapshot: render the dashboard with empty data + a "valkey degraded" pill.

We log fail-open events through `tracing::warn!` so observability catches them.

## 5. Error model — typed, traced, actionable

Today's errors are a mix of `{status, body: { error: 'rateLimited' }}` and ad-hoc strings. Tighten.

### 5.1 Server response shape

Every non-2xx response carries this body:

```json
{
  "error": {
    "code": "body.tooLarge",
    "message": "request body exceeds the per-route cap of 16 MB",
    "hint": "compress with gzip, or split into multiple uploads",
    "docUrl": "https://sentori.golia.jp/docs/errors/body-too-large",
    "correlationId": "01JEXY9Q...",
    "layer": "axum.body_limit"
  }
}
```

Fields:
- `code`: dotted, taxonomy-stable string. Public contract. Code reviews enforce no rename without migration.
- `message`: human-readable; carries the offending value when safe (sizes, counts; never tokens or PII).
- `hint`: what the caller can DO. Always actionable.
- `docUrl`: deep link to a per-code doc page on the marketing site (200-word explainer).
- `correlationId`: uuid-v7 set by the server's tracing middleware. Mirrors `X-Sentori-Correlation-Id` response header so the operator can grep server logs.
- `layer`: which subsystem rejected (`auth`, `ratelimit`, `axum.body_limit`, `db`, `valkey`, `domain.<feature>`). Tells you where to look.

Server-side `Error` enum per feature module → uniform conversion to the JSON above via `IntoResponse`. Builds on `anyhow::Error` for unstructured paths and converts at the boundary.

### 5.2 Client surface

```ts
export type AdminApiError = {
  body: {
    error: {
      code: string
      message: string
      hint?: string
      docUrl?: string
      correlationId: string
      layer: string
    }
  } | unknown
  correlationId?: string
  status: number
}
```

Dashboard error UI:
- Toast / inline banner shows `message` + `hint`.
- Expanded "details" reveals `correlationId` + `code` + `layer` for the operator.
- `docUrl` becomes a "learn more →" link.
- Copy-to-clipboard the `correlationId` so support requests aren't archaeological.

### 5.3 SDK error surface

SDK errors today log to `console.warn` only. Promote:
- Every operator-facing error gets a typed exception class (`SentoriHeartbeatError`, `SentoriUploadError`, …).
- Every typed error carries `code`, `hint`, `correlationId` (if server returned one).
- `__DEV__` mode: console.warn includes a one-line trail of last 3 sentori calls so the immediate cause is visible.

### 5.4 Error taxonomy (initial)

| code | layer | hint |
|---|---|---|
| `auth.missingToken` | auth | "include Authorization: Bearer <token>" |
| `auth.invalidToken` | auth | "token doesn't match this project / has been revoked" |
| `auth.expiredToken` | auth | "rotate via project settings" |
| `ratelimit.exceeded` | ratelimit | "back off, retry after X ms" |
| `body.tooLarge` | axum.body_limit | "compress / split / use upload-sourcemap" |
| `body.malformed` | parser | "invalid JSON / multipart at byte N" |
| `domain.invalidField` | domain.<feature> | per-field text |
| `domain.notFound` | domain.<feature> | "no such entity" |
| `domain.conflict` | domain.<feature> | "another writer modified this" |
| `internal.dbDown` | db | "service degraded, retry in 30 s" |
| `internal.valkeyDown` | valkey | "presence/rate-limit degraded; data path still serving" |

Per-code doc pages on the marketing site (writing those is a separate small project; the codes are the contract regardless).

## 6. Observability — every layer is traced

Sentori is a debug platform; eating its own dog food means every server route, SDK call, and dashboard hot path emits spans / metrics so we can debug ourselves.

### 6.1 Server spans

Every axum handler is wrapped in a `tracing::info_span!` with these baseline fields:

```
project_id, environment, route, method, status, correlation_id, duration_ms
```

Feature-specific fields layer on (`user_id`, `event_kind`, `cache_layer`, etc.). The existing self-instrument layer in router.rs (Phase 37) already does the wrapping; new modules just need to populate the right fields.

### 6.2 Client metrics

Dashboard reports its own perf metrics back to Sentori (yes, recursively):
- `dashboard.query.duration_ms` per react-query call, tagged by `queryKey[0]`
- `dashboard.cache.hit / miss` per query
- `dashboard.render.frame_ms` for heavy panes (replay player, audience)
- `dashboard.error.shown` counter, tagged by `code` from §5.4

SDK metrics similarly:
- `sdk.heartbeat.duration_ms`
- `sdk.heartbeat.failed`
- `sdk.transport.batch_size`
- `sdk.cache.hit_rate` (L1 in-memory)

These all flow through the existing `/v1/metrics:batch` endpoint.

### 6.3 The "self-test" page

`/admin/api/self-test` returns a JSON report: ingest latency p50/p95, valkey rt, db rt, last cert-monitor poll, last digest run. Dashboard surfaces it on the Overview as a green/amber/red strip — operators see "platform is healthy" without digging into Grafana.

## 7. Code quality discipline (server)

The crate is medium-sized; future modules must not regress.

- **No `unwrap()` in handler / hot paths**. `?` + typed errors.
- **No `String` keys in HashMap when an enum exists.** Compile-time exhaustiveness on signal taxonomy beats grep.
- **No `pub fn` that doesn't carry doc.** `clippy::missing_docs_in_private_items` is opt-in but we lean on it.
- **Modules under 800 lines.** Split when they grow.
- **One-line `tracing::info!("event=X field=Y")`** for the audit trail in domain operations. Free-form is fine but include the fields.
- **`#[non_exhaustive]` on every public enum + struct** that we expect to extend across versions.
- **Property tests (`proptest`)** for any algorithm with a non-trivial invariant (scoring functions, dedup, retention math).

## 8. Code quality discipline (client)

- **Typed query keys**: `['live', projectId]` becomes `liveKey(projectId)` returning a typed tuple. No string concat in queryKeys.
- **All extracted types live in `@/api/client` or a feature `types.ts`**. No anonymous shapes leaking through `useQuery` callers.
- **Strict null checks** everywhere (already on).
- **No `any` in shared modules**. Tests OK to be loose.
- **`React.memo` only when there's a measurement supporting it.** Premature memoisation is a code smell.
- **No state imports across module boundaries.** Each module's state stays inside that module; cross-module sharing goes through react-query or a defined atom.

## 9. Client state architecture

Three tiers:

```
1. URL / route state — react-router's useParams / useSearchParams
2. Server state mirror — react-query
3. Local UI state — useState / nanoatoms / valtio
```

**Rules**:
- Never mirror server state into useState. The query is the source of truth.
- Local UI state must be reset-able by closing the page. Persisting filter selections is OK via URL params (URL-as-state).
- For RN dashboard parity later, the same atoms work via `jotai-mmkv` adapter. Don't lock into web-only state libs.

## 10. SDK perf discipline (iron rule, cross-referenced)

CLAUDE.md states the rule. Every SDK addition checks back to:

- `< 1 ms / call` main-thread cost target for foreground hot paths
- `< 1 KB / minute` ambient bandwidth target
- background work via setTimeout/setInterval that's *paused* on AppState=background
- explicit perf budget table in the feature's design doc (analytics-v1 §7, security-posture-v1 §9 both have them)

## 11. Deployment + migration discipline

- **Migrations are forward-only and idempotent.** `IF NOT EXISTS` everywhere; never `DROP`.
- **No code change that requires manual ops.** Schema migration on boot, Valkey keys self-expire, secrets via env.
- **Feature flags via `project_settings` table**, NOT via dashboard env vars. New features default to off; operator opts in per project.
- **Rollback story for every release**. Each chunk's ship plan documents what gets rolled back if the post-deploy verify fails. Today we ride on git-revert + redeploy; that's our story until proven painful.

## 12. Documentation discipline

- **Every public API endpoint has a /docs page**. Auto-generated where possible (OpenAPI for now is hand-maintained at `docs/protocol.md`).
- **Every error `code` has a /docs/errors/<code>.md** with the same shape: what it means, why you got it, how to fix.
- **Design docs live in /docs/design/<feature>.md.** Updated when scope shifts. Stale doc > no doc.
- **Runbook docs in /docs/runbook/**. Step-by-step recovery procedures for the operational stuff.

## 13. Standards adoption rollout

This is a standards document; landing it doesn't change code. The rollout looks like:

1. Land this doc (this PR).
2. Retrofit analytics-v1 (already-shipped chunk A) to comply — error shape uplift, react-query persistence, optional SSE for /live.
3. Apply to security-posture-v1 BEFORE implementation (so S1 is built right the first time).
4. Sweep existing modules in a maintenance pass — drop in correlation ids, typed errors, key naming where it's straying.

§2 (cache) and §5 (errors) deliver the biggest UX uplift; do those first. WASM (§3) is opt-in per feature when a measurement justifies it.

## 14. Open questions

1. **Push vs pull for L2 invalidation**. When the server knows the L2 cache on a particular client is stale (e.g. a project setting changed), do we WS-push an invalidation? Or wait for the next L1 refetch? Push is faster, pull is simpler. Recommended default: pull for v1; instrument the "stale cache observed" metric; revisit if it grows.
2. **WASM build pipeline**. We can either ship per-feature .wasm files or one combined module. Combined keeps the cross-fn JIT warm; per-feature is easier to lazy-load. Recommended default: per-feature lazy-loaded; one shared utility wasm for hashing / compression.
3. **localStorage size budget**. 5 MB cap above is the typical browser limit before quotaExceeded. With IndexedDB the budget can be 100 MB+. Move L2 to IndexedDB when any single feature wants more than 1 MB.
4. **Error doc auto-generation**. Hand-writing per-code .md pages is ~100 pages. Worth a small generator that reads the Rust error enum + per-variant doc comments and emits .md. Slot for a small chunk later.

## 15. What you'd see if all of §0 was done well

- A user opens the dashboard. Live page paints from L2 within 20 ms; SSE stream catches up missed deltas within 500 ms. They've never seen a loading spinner.
- They make a mistake (paste a bad release name). The dashboard shows: `"Bad release name 'fo-1234'. Releases look like '<app>@<version>+<build>'. (code: domain.invalidField · cid: 01JEXY9Q…)"`. They paste cid into a chat to support; we grep server logs to that exact request.
- The dashboard's own perf strip shows `ingest p95 32 ms · valkey 1 ms · db 9 ms`. Operator senses "everything is healthy" without leaving the app.
- A new feature ships: its design doc references this standards doc, applies cache hierarchy, uses typed errors, fail-open Valkey, observability spans wired. Code review enforces the standards.

That's what "极专业" means here: discipline made invisible.
