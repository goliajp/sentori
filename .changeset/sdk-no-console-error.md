---
"@goliapkg/sentori-core": patch
"@goliapkg/sentori-react": patch
"@goliapkg/sentori-next": patch
---

fix(sdk): never emit `console.error` from runtime paths — host apps reading red `[sentori]` lines mistake them for their own app crashing and pull Sentori out. Downgraded to `console.warn`:

- `sentori-core`: `logger.error(...)` now routes to `console.warn` in the default console emit path. Host-supplied log transports still receive the real `error` level so they can route it to their aggregator however they like.
- `sentori-react`: `SentoriProvider` init-failure catch block.
- `sentori-next`: `clientInit` and `serverInit` failure catch blocks.

The runtimeMetrics flush-failure channel that triggered the original report runs through `reportInternal → logger.error → console.error` in the host's runtime; the `sentori-core` fix closes the channel at the source for every downstream SDK.
