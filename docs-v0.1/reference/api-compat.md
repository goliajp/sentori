# API compatibility matrix

How v0.1 relates to the **currently-running** SaaS at
`sentori.golia.jp`. Important: **v0.1 does NOT replace
legacy in this ship**. Legacy server keeps serving every
`/v1/*` route below until the explicit SH5 cutover step;
v0.1 ships as additive infrastructure.

## Three deployment modes after v0.1 lands

| Mode | Binary | What it serves |
|---|---|---|
| **Current SaaS** (legacy, still live) | `server/` (legacy mono-repo crate) | All `/v1/*` routes below + dashboard. Stays running at sentori.golia.jp until SH5. |
| **New SaaS control plane** (v0.1, *new* paths) | `saas/server/` | `/v1/saas/*` only — tenant CRUD + Stripe webhook + saasadmin. **Adds**, doesn't replace. |
| **Self-hosted OSS** (v0.1, *new* deployment*) | `self-hosted/server/` | The v0.1 ingest/dashboard surface — no legacy compat baggage (greenfield deployments). |

`*` Self-hosted is greenfield: nobody is migrating from
"legacy self-hosted" (legacy was SaaS-only). The v0.1
self-hosted binary intentionally does NOT clone legacy's
86-file API surface — it ships the K-tier essential
subset.

## SDK ingest compatibility (load-bearing)

If an SDK in production breaks, customers lose events —
this matrix is the critical one.

| Path | Method | Legacy serves | v0.1 self-hosted | v0.1 saas control plane | Notes |
|---|---|---|---|---|---|
| `/v1/events` | POST | ✓ | △ (`/v1/events/:project_id` in v0.1) | — | v0.1 path-encodes project; legacy used auth token. Both shipped. |
| `/v1/events:batch` | POST | ✓ | planned | — | K4 IngestService supports batch; route TODO. |
| `/v1/heartbeat` | POST | ✓ | planned | — | K9 metrics counter increment + record_drop. |
| `/v1/spans`, `/v1/spans:batch` | POST | ✓ | planned | — | K6 SpanStore. |
| `/v1/sessions` | POST | ✓ | planned | — | Aggregate session counter; maps to K9. |
| `/v1/deploys` | POST | ✓ | planned | — | Release marker — small table addition pending. |
| `/v1/user-reports` | POST | ✓ | planned | — | Maps to K3 attachment-store + K5 issue link. |
| `/v1/metrics:batch` | POST | ✓ | planned | — | Custom metric ingest; K9 has the shape. |
| `/v1/track:batch` | POST | ✓ | planned | — | Track events → K4 with `kind = "message"`. |
| `/v1/security:report` | POST | ✓ | defer K17.x | — | Security telemetry — defer. |
| `/v1/security/score` | GET | ✓ | defer K17.x | — | Trust-score lookup. |
| `/v1/security/link` | POST | ✓ | defer K17.x | — | Identity federation link. |
| `/v1/control/poll` | GET | ✓ | defer K17.x | — | Live-debug remote control channel. |
| `/v1/events/_recent` | GET | ✓ | planned | — | Internal recent-events tail; K4 query. |

**Status legend** — ✓ implemented · △ different path · planned · defer to follow-up.

## Dashboard read compatibility

Legacy dashboard endpoints live under `/admin/api/*` —
not browser-call-stable so we have room to redesign in
v0.1. Plan: dashboard rewrite (Phase 5 webapp) consumes
new v0.1 routes; the legacy dashboard stays bound to
legacy server until the cutover swaps the DNS.

## SaaS control plane (genuinely net-new in v0.1)

These routes don't exist in legacy — they're the new
multi-tenant + billing surface:

| Path | Method | Where |
|---|---|---|
| `/healthz` | GET | `saas/server` |
| `/v1/saas/tenants` | GET / POST | `saas/server` |
| `/v1/saas/stripe/webhook` | POST | `saas/server` |

Future expansion (CSaas3 follow-up):
- `/v1/saas/tenants/:id/{suspend,resume,delete}`
- `/v1/saas/saasadmin/{login,logout,sessions}`
- `/v1/saas/tenants/:id/usage` — cross-tenant usage dashboard

## Cutover strategy (SH5)

Phase plan for legacy → v0.1 SaaS replacement:

1. Spin up the v0.1 saas control plane on a parallel
   subdomain (`api-v2.sentori.golia.jp`). Verify
   tenant provision flow works end-to-end with a
   throwaway tenant.
2. Port each legacy SDK ingest endpoint to the new
   self-hosted/server (incremental — one at a time;
   verify SDK still works against per-tenant DB).
3. Front legacy + v0.1 with the same Caddy. Route 1%
   of one customer's SDK traffic to v0.1; watch the
   K9 dropped-counters dashboard.
4. Once all `/v1/*` ingest paths are at parity, flip
   DNS to v0.1 atomically. Legacy server stays warm
   for a 14-day rollback window.
5. SH6 retire — delete `server/` + `web/` after the
   rollback window passes.

Until SH5 fires, **the user-facing API surface is
exactly what legacy serves today.** v0.1 is additive
infrastructure that doesn't affect production behaviour.
