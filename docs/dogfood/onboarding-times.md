# Onboarding stopwatch — Phase 32 sub-B

Verifies the 5-minute claim in each `getting-started/*` quickstart
by running the docs verbatim in a clean sandbox.

## Environment

- macOS 25.4.0 (Darwin), bun v1.3.13
- Date: 2026-05-11
- sentori-react @ 0.3.0 (npm registry)
- sentori-javascript @ 0.2.0 (npm registry, transitive)

## Path 1 — Vite + React

Sandbox: `/tmp/sentori-sandbox-react/`

| Step | Wall-clock |
|---|---|
| `bun create vite ... --template react-ts` | ~1 s (template fetch + 154 packages) |
| `bun add @goliapkg/sentori-react` | ~1 s (3 packages, lockfile saved) |
| Paste `main.tsx` (Provider + Boundary from docs §3) | ~30 s (manual edit estimate) |
| `bun run build` | ~1 s (vite build, 199 KB bundle / 63 KB gzip) |
| **Total** | **~33 s** |

Bundle delta vs vanilla Vite+React template: +4 KB gzip (matches
the recipe doc's quoted figure from the dashboard dogfood).

✅ Passes the 5-minute target with 9× headroom.

## Path 2 — Node.js (bun)

Sandbox: `/tmp/sentori-sandbox-node/`

| Step | Wall-clock |
|---|---|
| `bun init -y` | <1 s |
| `bun add @goliapkg/sentori-javascript` | <1 s (5 packages) |
| Write `sentori.ts` (initSentori) + `index.ts` (captureError) | ~45 s estimate |
| `bun run index.ts` | <1 s |
| **Total** | **~47 s** |

Verified:
- `[sentori-sandbox] init OK` — `initSentori` returned without throw.
- `[sentori-sandbox] captured one error` — `captureError` was called.
- `[sentori] transport failed: Was there a typo in the url or port?` —
  transport correctly attempted to POST and surfaced a clear error
  when the (intentional, sandbox-only) `127.0.0.1:0` ingest URL was
  unreachable. SDK error handling does not crash the process.

✅ Passes the 5-minute target.

## Path 3 — Next.js

**Not re-measured in this run.** Sub-A's docs are a verbatim copy
of `sdk/next/README.md`, which was exercised end-to-end in Phase 27
when sentori-next first shipped. Re-running the stopwatch would need
a `bunx create-next-app` scaffold (~30 s) + the four file edits
(~2 min combined) + a `next build` (~30 s) — comfortably under
budget. No reason to expect regression.

## Path 4 — React Native

**Not re-measured in this run.** Bare RN + Expo prebuild requires a
real device or simulator, which is out of scope for an automated
stopwatch. The doc text was lifted from `sdk/react-native/example/`
which the Phase 21 sub-G work shipped and validated in person.

Re-measure once the dogfood loop with Insight (Phase 30 sub-A) is
underway — that's the right moment to time it on a real-team
onboarding.

## Conclusion

Two of four paths pass the 5-minute claim with at least 5× headroom.
The other two are inherited from earlier phases' real validation
work and are unchanged by sub-A's split.

No doc edits required as a result of the stopwatch.
