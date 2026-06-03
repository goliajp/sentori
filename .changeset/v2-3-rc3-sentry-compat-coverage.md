---
"@goliapkg/sentori-react-native": patch
---

v2.3 W6.3 — Sentry-compat translation coverage + test surface.

The compat module (`@goliapkg/sentori-react-native/compat`) was
already substantively implemented (DSN parser, init, captureException,
captureMessage, setUser with `ip_address` drop + `segment → tag`
remap, setTag, addBreadcrumb category-to-type mapping, withScope,
configureScope, startTransaction, close, flush, Severity enum,
warn-once dedup). This patch adds:

- Test exports for the three pure-function pieces:
  `__parseDsnForTests`, `__mapCategoryToTypeForTests`,
  `__mapLevelForTests`. Direct callers should keep using
  `Sentry.init` / `Sentry.addBreadcrumb` / `Sentry.captureMessage`;
  the hooks exist so the unit test can verify the translation
  table without mocking the entire native init chain.
- 18 new unit tests (`__tests__/compat-sentry.test.ts`):
    parseDsn (5 cases: happy path, custom port, wrong token
      prefix, missing token, malformed URL),
    mapCategoryToType (6 cases covering user / net / nav / log
      buckets + unknown → custom + undefined),
    mapLevel (3 cases: Critical → fatal, Log → info, 5-level
      passthrough, undefined),
    Severity export (3 cases).

No behaviour change. The compat surface itself was already shipped
and unchanged; this is purely test coverage filling a Phase 5 gap.
