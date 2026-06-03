---
"@goliapkg/sentori-core": minor
"@goliapkg/sentori-javascript": minor
"@goliapkg/sentori-react-native": minor
---

v2.3 W6.0 — silent-by-default SDK logger.

The SDK now ships a centralised logger module (`logger.error/warn/info/debug`)
gated by a single `LogLevel` setting. Default level is `'warn'`: a normal Sentori
install adds zero `[sentori]` lines to the host's console under healthy
operation. Real problems (transport sustained failure, native module not bound,
SDK-internal exception) still surface.

New init fields:

- `init({ logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug' })` — gates
  the host-facing console output. Default `'warn'`.
- `init({ onReady: (info) => ... })` — fires once after init completes with a
  shared `ReadyInfo` shape (`sdkVersion`, plus RN-only `coldStartMs` + `native`).
  Use this to know the SDK is live without scanning the console.

New host APIs (re-exported from each SDK):

- `setLogLevel(level)` / `getLogLevel()` — change the gate at runtime.
- `setLogTransport(fn)` — route Sentori-internal lines into the host's own
  logger (Datadog, OpenTelemetry, etc.); pass `null` to restore console.
- `logger` namespace + `LogLevel` / `LogTransport` types for hosts that want to
  produce subsystem-prefixed lines themselves.

JS SDK additions (RN was already wired in prior commits): `logLevel`, `onReady`,
and the new canonical `sample` field (alongside the existing `sampling`
back-compat alias). No behaviour change beyond log silence; existing init calls
keep working.

Mechanical perf bench (`sdk/core/src/__tests__/perf.bench.ts`) extended with
logger budgets — gated-out `logger.debug` < 1 µs/op, emit through transport
< 5 µs/op, `setLogLevel` toggle < 1 µs/op. Baseline numbers recorded at
`docs/perf-baselines/v2.2.1.md` for Phase 3 (W6.1) to diff against.
