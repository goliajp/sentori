# docs/

Source markdown for the protocol spec, getting started, the SDK
guide, self-hosting and troubleshooting. **These files are the
documentation** — read them here or in the OSS mirror.

There was an Astro Starlight site (`docs-site/`) and a marketing site
(`marketing/`) in this repo until 2026-08-10. Nothing routed to
either: `docs.sentori.golia.jp` redirects to the dashboard and
`sentori.golia.jp/docs/` is the SPA's catch-all. Between them they
documented a Sentry compatibility layer this product deliberately does
not have, four web-framework SDKs whose source is not in this repo,
and a Free / Pro / Enterprise pricing page for a product with no
signup and no billing. Thirty thousand files, built by no gate and
served to nobody — the OSS mirror excluded them, so not even a
self-hoster ever saw them. Deleted; the history has them.

## Start here

If you are integrating, in this order:

1. [`getting-started.md`](getting-started.md) — install, first event,
   and a curl that is executed by a gate so it cannot rot.
2. [`getting-started/react-native.md`](getting-started/react-native.md)
   — the SDK path end to end.
3. [`protocol.md`](protocol.md) — the wire schema, batching, token
   format, sourcemap upload.
4. [`errors.md`](errors.md) — every error code this server sends.
   Generated from the handlers; do not edit by hand.
5. [`troubleshooting.md`](troubleshooting.md) — the failure modes
   people actually hit, with the hints the server really sends.

A running instance also serves [`/llms.txt`](../webapp/public/llms.txt),
which carries enough to send a first event without following any link.

## SDK reference

Five SDKs, one wire format, one set of five verbs. Each page is the
API surface that ships with its package:

- [`sdk-swift.md`](sdk-swift.md) — native iOS and tvOS, no React
  Native.
- [`sdk-kotlin.md`](sdk-kotlin.md) — native Android, no React Native.
- [`../sdk/react-native/README.md`](../sdk/react-native/README.md) —
  React Native and Expo.
- [`../sdk/web/README.md`](../sdk/web/README.md) — the browser, any
  framework or none.
- [`../sdk/weapp/README.md`](../sdk/weapp/README.md) — WeChat mini
  programs. Needs an instance on a domain with an ICP filing; the
  platform will not call anything else.

This said "there is one SDK guide because there is one SDK" until
2026-09-30, while two native guides sat in this directory with nothing
anywhere linking to them. A native team read the front page and
concluded the product did not support them.

## Self-hosting

- [`self-hosting.md`](self-hosting.md) — environment variables,
  backup / restore, Postgres upgrade notes.
- [`teams.md`](teams.md) — accounts, roles, project assignment.
- [`runbook/scaling.md`](runbook/scaling.md) — what to read before
  adding capacity, and what this topology does not do.
- [`runbook/cli-auth.md`](runbook/cli-auth.md) — how the CLI
  authenticates, and which token each command wants.

## Wire formats

- [`replay-encoding-v2.md`](replay-encoding-v2.md) — the replay
  attachment format: keyframe plus deltas, one NDJSON line per frame.
  Read this before writing anything that produces or consumes a
  replay.

## Recipes

- [`recipes/sourcemap-upload.md`](recipes/sourcemap-upload.md)
- [`recipes/release-versioning.md`](recipes/release-versioning.md)

## What is not here

Pages describing versions that no longer exist — the pre-v1 SDK
reference, the web packages that never reached npm — are not kept in
this repository. The CHANGELOG is the history; `git log` is the record.
