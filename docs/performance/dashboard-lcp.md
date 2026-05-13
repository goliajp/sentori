# Dashboard LCP — Lighthouse CI gate

Phase 47.05 — perf budget for the dashboard SPA. The runtime
contract is **LCP < 1.2 s** measured by Lighthouse CI's autorun
against a local `vite preview` server.

## What's gated

`web/lighthouserc.cjs`:

| Metric | Severity | Threshold |
|---|---|---|
| Largest Contentful Paint | **error** (fails the build) | < 1200 ms |
| First Contentful Paint | warn | < 1500 ms |
| Total Blocking Time | warn | < 200 ms |
| Cumulative Layout Shift | warn | < 0.1 |

Throttling preset: `desktop`. Mobile is a different gate we may add
later; for now this is the dashboard, which power users hit from
their workstation.

## Run it

```sh
cd web
bun run build              # vite build → dist/
bun run preview &          # serves dist/ on http://localhost:4173
bun run lhci               # 3 runs, median, asserts the budget above
kill %1                    # stop preview
```

`bun run lhci` is a thin wrapper around
`bunx @lhci/cli@^0.16 autorun --config=./lighthouserc.cjs` — no
node_modules install needed; the CLI is fetched per-invocation.
Results upload to lhci's temporary-public-storage bucket (7-day
TTL); the run prints the URL to the report.

## Pages currently measured

- `/login` — the public landing page. Picked first because it has
  no auth dependencies (so the run is deterministic) and is the
  largest hydration burden in a cold visit.

To extend: add URLs to `collect.url` in `web/lighthouserc.cjs`. Each
extra URL adds ~30 s to the run — be selective; we don't gate every
route.

## CI hook-up

Not wired into GitHub Actions yet. To add:

1. Job runs `cd web && bun install --frozen-lockfile`.
2. `bun run build && bun run preview &`, then `npx wait-on
   http://localhost:4173`.
3. `bun run lhci` — exit-non-zero on assertion failures fails the
   job.
4. Upload `web/.lighthouseci/` as a workflow artifact.

The autorun honours `LHCI_TOKEN` + `LHCI_SERVER_BASE_URL` env vars
if you later host an LHCI server for historical trends; the
temporary public storage is fine while we don't have one.
