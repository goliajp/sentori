---
title: Multi-environment
description: One token, multiple environments — staging vs prod, the right way
---

# Multi-environment

Most teams want events from staging and production to flow into the
same project (so triage tooling stays in one place) but still be
filterable separately on the dashboard. Sentori's `environment`
field on every event is what makes this work.

## The default

```ts
sentori.init({
  token: 'st_pk_...',
  release: 'myapp@1.2.3+456',
  environment: 'prod',   // ← here
  ingestUrl: 'https://ingest.sentori.golia.jp',
})
```

The dashboard's Issues list has an `env` filter chip in the toolbar.
Click it, pick `staging`, and only staging events show up — same
project, same token, separate view.

## Recommended values

| Value | When |
|---|---|
| `prod` | Real users, real traffic |
| `staging` | Pre-prod with prod-like data |
| `qa` | QA team's manual test build |
| `dev` | Local development (often skipped — see below) |
| `preview` | Vercel / Netlify per-PR preview deployments |

Use lowercase, short, hyphen-free. The dashboard's filter UI
truncates long values — `production-us-east-1` is going to read
worse than `prod`.

## Auto-detect from build

### Vite

```ts
sentori.init({
  // ...
  environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
})
```

For staging / preview deploys, set `VITE_SENTORI_ENVIRONMENT`
explicitly in CI rather than relying on `MODE` (which is always
`production` for any non-dev build).

### Next.js

```ts
sentori.init({
  // ...
  environment: process.env.NEXT_PUBLIC_SENTORI_ENVIRONMENT
            ?? (process.env.VERCEL_ENV === 'preview' ? 'preview'
              : process.env.NODE_ENV === 'production' ? 'prod'
              : 'dev'),
})
```

`VERCEL_ENV` is the source of truth on Vercel — `production`,
`preview`, or `development`.

### React Native

```ts
sentori.init({
  // ...
  environment: __DEV__ ? 'dev' : 'prod',
})
```

For staging RN builds (TestFlight / internal track on Play Store),
inject a different env at build time via `app.config.ts`'s `extra`
field, the same way you inject `release`.

## Should you send `dev` events at all?

Usually no. Two reasons:

- Local dev surfaces 10x more errors than prod (you're literally
  trying to break things). The dashboard becomes noisy and the rate
  limiter starts dropping events.
- Stack traces from dev builds aren't matched against prod
  source maps, so they're less useful for triage than they look.

The cleanest pattern is to skip init entirely in dev:

```ts
if (!__DEV__) {
  sentori.init({ /* ... */ })
}
```

```ts
// or for web
const sentoriToken = import.meta.env.VITE_SENTORI_TOKEN
if (sentoriToken && import.meta.env.MODE === 'production') {
  // wrap with SentoriProvider only in real builds
}
```

If you do want dev events, use a separate `dev` project (not just
`environment=dev` in the same project). It avoids polluting prod's
quota and metrics.

## Token strategy

You have two choices for staging vs prod:

### Single token, distinguished by `environment`

```
token:       same st_pk_... everywhere
environment: prod | staging | preview
```

**Pros:** one secret to rotate, one quota to manage, one dashboard
view to triage with the env filter.

**Cons:** anyone with a staging build can technically send events
labelled `production`. If that's a concern, rotate the token
whenever staging is leaked beyond your trust boundary.

### One token per environment

```
prod:    st_pk_prod_...
staging: st_pk_staging_...
preview: st_pk_preview_...
```

**Pros:** strict isolation. Revoking the staging token doesn't
affect prod. Per-token rate limits.

**Cons:** more secrets to rotate, three tokens to keep straight in
CI, the dashboard combines events from all three projects (or you
split into multiple projects, which fragments triage).

**Recommended:** start with single token + `environment` field, and
only split to per-env tokens if you have an actual isolation
requirement (regulated industry, untrusted contractors, etc).

## Filter UI on the dashboard

The Issues list toolbar shows an `env: prod` chip by default. Click
to cycle through `prod` → `staging` → `preview` → `all`. The chip
is persisted in the URL (`?env=staging`), so deep links round-trip
cleanly and bookmarks stay in the right view.

Alerts respect the env filter too. An alert rule scoped to
`environment = prod` won't fire on a matching event from staging,
even if both go through the same project.
