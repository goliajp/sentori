---
title: Find bugs with /explore — one query, two consumers
description: v2.2 ships a single typed query endpoint that backs both the Issues / Releases dashboard views and any AI agent calling Sentori from outside. Same URL state, same JSON, no separate "agent API". How to use it.
---

# Find bugs with `/explore`

v2.2 added one HTTP route — `POST /admin/api/projects/{p}/explore` —
that powers the entire find-bug surface of the dashboard. The
**Releases** module is a preset call to it (`dim=release`). The
**Issues** list is another (`dim=issue`). The trend sparkline at the
top of Releases is a third (`dim=time_bucket`).

The same endpoint is what an AI agent calls. There's no separate
"agent-friendly" wrapper. The endpoint is enum-constrained on the
server side (no SQL passthrough), validated cheaply on the
dashboard side, and shares a URL grammar with the UI — so when an
operator pastes a Sentori URL into a chat with you, you can read
the same data back without guessing.

## The mental model

Three concepts, written down once:

- **`dim`** — what each row is. `release` / `issue` / `time_bucket`.
- **`measures`** — what numbers go in those rows. Pick from
  `event_count` / `issue_count` / `resolved_count` / `unique_users`
  / `first_seen` / `last_seen`.
- **`filters`** — what slice of the world to count. Time window
  (`receivedAtGte` / `receivedAtLt`), environment (`environmentEq`),
  release (`releaseEq`), event kind (`kindIn`), issue status
  (`statusIn`).

Every view in the find-bug lens is `(dim, measures, filters)` plus
an `orderBy` choice. That's the whole grammar.

## From the dashboard

### Releases

Open `/main/<org>/<project>/releases`. The page calls:

```http
POST /admin/api/projects/<project_id>/explore
Content-Type: application/json

{
  "dim": "release",
  "measures": ["event_count", "issue_count", "resolved_count",
               "unique_users", "first_seen", "last_seen"],
  "filters": { "receivedAtGte": "2026-05-27T00:00:00Z" },
  "orderBy": "last_seen",
  "orderDir": "desc",
  "limit": 200
}
```

Pick `?window=1d|7d|30d|all` from the toolbar — that's the only
dial. Each row is one release, sortable by any measure. The
release-name cell is a link into `/releases/:release`, which calls
`/explore` again with `dim=issue` + `releaseEq=<that-release>` to
show the issues that fired in that build.

### Issues

Open `/main/<org>/<project>/issues`. v2.2 W3 swapped the legacy
list backend for `/explore`:

```http
POST /admin/api/projects/<project_id>/explore
{
  "dim": "issue",
  "measures": ["event_count", "unique_users", "first_seen", "last_seen"],
  "filters": {
    "statusIn": ["active"],
    "receivedAtGte": "2026-05-27T00:00:00Z"
  },
  "orderBy": "event_count",
  "orderDir": "desc",
  "limit": 100
}
```

Three new pickers above the rail:

- **status tab** (active / regressed / muted / resolved /
  silenced / all) → `filters.statusIn`
- **sort** (events / users / last seen / first seen) → `orderBy`
- **window** (1d / 7d / 30d / all) → `filters.receivedAtGte`

Cross-module deep-link filters (`?release=`, `?errorType=`, `?env=`)
map onto `filters.releaseEq`, `filters.kindIn`, `filters.environmentEq`.

If the new path misbehaves, fall back with `?legacy=1` — the old
keyset-paginated `listIssuesPage` endpoint is still live during W3
dogfood. The rail header tells you which path is active
("source: /explore · 47 ms" vs "source: legacy · ?legacy=1").

The search box (`?q=`) stays client-side — v2.2 `/explore` has no
full-text filter, and the 100-row result cap makes a client-side
match across `errorType + messageSample` cheap.

## Sharing a slice

URL state is the contract. Send a teammate this:

```
https://sentori.golia.jp/main/org/acme/proj/issues
  ?status=regressed&window=30d&measure=unique_users&release=myapp@1.2.3
```

They see exactly your view. Refresh-stable, bookmark-stable.

Send the same URL to an AI agent and ask "summarise this list."
The agent can either screen-scrape the page **or** pull the data
fresh by translating the URL params into an `/explore` call. Same
filters, same window, same numbers — by construction.

## From an agent / CLI

`curl` example, using the same payload the dashboard would build:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Cookie: <your admin session>" \
  https://api.sentori.golia.jp/admin/api/projects/$PROJ/explore \
  --data '{
    "dim": "issue",
    "measures": ["event_count", "unique_users"],
    "filters": {
      "statusIn": ["regressed"],
      "receivedAtGte": "'$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)'"
    },
    "orderBy": "event_count",
    "orderDir": "desc",
    "limit": 25
  }'
```

Response:

```jsonc
{
  "rows": [
    {
      "issue_id": "01j…",
      "error_type": "TypeError",
      "message_sample": "Cannot read properties of undefined…",
      "last_release": "myapp@1.2.3",
      "status": "regressed",
      "event_count": 4218,
      "unique_users": 312
    },
    // …up to limit
  ],
  "totals": {
    "event_count": 9871,
    "unique_users": 514,
    "issue_count": 25,
    "row_count": 25
  },
  "meta": {
    "dim": "issue",
    "measures": ["event_count", "unique_users"],
    "rowCount": 25,
    "tookMs": 38,
    "receivedAtGte": "2026-05-27T00:00:00Z",
    "receivedAtLt": "2026-06-03T00:00:00Z"
  }
}
```

`meta.receivedAtGte` / `receivedAtLt` echo the window the server
actually used — if the caller omitted the filter, the server filled
in defaults (last 7 days) and the response says so. That's how an
agent confirms what it asked for without re-reading its own
request.

## Decision table — Issues vs Releases vs time_bucket

| You want to answer | Use |
|---|---|
| "Which release caused the most new pain?" | `dim=release`, `orderBy=event_count`, 7-30 day window |
| "Which release fixed the most?" | `dim=release`, `orderBy=resolved_count` |
| "Which crash is biting the largest cohort right now?" | `dim=issue`, `orderBy=unique_users`, 1-7 day window, `statusIn=['active','regressed']` |
| "Where am I regressing?" | `dim=issue`, `statusIn=['regressed']`, 7 day window |
| "Show me the event rhythm" | `dim=time_bucket`, `measures=['event_count']` |
| "How many users does *this specific issue* hit?" | Open the issue detail page — it has its own enriched query (`/explore` doesn't yet have an `issueEq` filter). v2.3 will close this gap. |

## What `/explore` is NOT (in v2.2)

- **Not a SQL escape hatch.** Adding a new `dim` or `measure` is a
  Rust match arm in `server/src/api/admin/explore.rs`. There's no
  way to query a free-form column.
- **Not bucketed by issue.** No `issueEq` filter, no per-issue
  sparkline. Both land with the dim grammar expansion in v2.3.
- **Not real-time.** Queries run on the production Postgres at
  whatever lag the events table already has (~ms during normal
  load). There's no streaming subscription — agents poll on a
  schedule, the dashboard re-fetches on URL change.
- **Not multi-project.** One project per call. Superadmin /
  cross-org analytics is its own L2 (v2.3+).
- **Not writable.** Read-only endpoint. Saved views / alerting on
  results / scheduled exports are all out of scope for v2.2.

## Related

- [`manual-issue`](./manual-issue.md) — `captureMessage` for the
  signals that should *open* an issue in the first place.
- [`track-and-metrics`](./track-and-metrics.md) — when the right
  pipeline is `track` / `recordMetric`, not `captureException`.
- [`endpoint-health`](./endpoint-health.md) — synthetic probes
  whose failures open auto-issues; once opened, they show up in
  the same `/explore` results.
