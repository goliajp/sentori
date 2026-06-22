# Concept overview

Sentori is an RN-first error monitoring + APM toolchain
designed to be embedded by the host app with **zero
perceptible performance cost** and run by the operator
with **one container** for the OSS self-hosted tier.

## v0.1 architecture in one paragraph

The data plane is a Rust workspace of 17 K-tier (钢筋)
crates and 13 S-tier (石头) stones that handle every
ingest-side concern: event capture (K4), issue triage
(K5), span tracing (K6), session replay (K8), push tokens
(K7), runtime metrics (K9), CT log monitoring (K10),
notifier transports (K11), integration adapters (K12),
audit log (K13), alert rules (K14), saved views (K15),
per-project ACL (K16), and billing quotas (K17). A single
binary (`sentori-server`) composes them all into an axum
HTTP server backed by Postgres 18. The SaaS control
plane (`sentori-saas`) is a sibling binary that handles
multi-tenant provisioning + Stripe webhook ingest — it
spawns one `sentori-server` instance per tenant against
a dedicated postgres database.

## Three principles

1. **One workspace = one Postgres database** — clean
   single-tenant boundary. SaaS does it by giving each
   tenant their own DB; self-hosted does it by having a
   single DB per install.
2. **Caller-owned background tasks** — every K crate
   exposes synchronous `try_*` methods, no internal
   `tokio::spawn`. Callers wire up their own cron loops
   so test rigs can drive deterministic behaviour.
3. **No new tables when composition suffices** — K16
   (tenant scoping) composes K1 primitives (no new
   tables). Pure composer crates avoid schema sprawl.

## What's where

| Tier | Path | Test count |
|------|------|------------|
| 石头 (stones) | `core/crates/{license-jwt, privacy-salt, issue-fingerprint, event-ringbuffer, stripe-webhook-verify, sourcemap-resolver, dwarf-resolver, proguard-resolver, cookie-session, rate-limiter, geoip-reader, secrets-vault, argon2-password}` | ~500 |
| 钢筋 (steel) | `core/crates/{workspace-identity, auth-session, attachment-store, event-pipeline, issue-store, span-store, push-provider, replay-store, runtime-metrics, cert-monitor, notifier, integration-traits, audit-event, alert-rule, saved-view, tenant-scoping, billing}` | ~600 across 17 crates |
| 水泥 (cement) | `self-hosted/server` (OSS), `saas/server` (control plane) | growing |

Total: 0 unsafe code in core/; clippy `-D warnings` clean
across the entire workspace; every K crate has a
testcontainers Postgres 18 integration suite.

## SDK story

Sentori SDKs (RN-first; iOS / Android native + JS bundle)
do everything client-side: stack capture, source-map
unminify, breadcrumbs, session replay sampling. They post
to `POST /v1/events/<project_id>` as JSON. Auth is via a
public DSN-equivalent token; rate limiting is K-tier
sliding window keyed by token.

Per the铁律 in `.claude/CLAUDE.md`, the SDK must add
< 1% main-thread CPU + < 1% frame drops on a mid-tier
device. v0.1 ships only the data-plane backend; SDKs
ride v2 cadence.
