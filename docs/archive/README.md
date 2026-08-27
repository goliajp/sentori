# docs/archive/

Kept, not current. Nothing in here describes the product as it is
today, and none of it is published to the OSS mirror.

It is a directory rather than a warning banner at the top of each file
because a banner is something a reader has to notice. A path is
something a machine can filter on, and `check-docs-api-truth.mjs`
skips this tree for exactly that reason: the pages below name APIs
that no longer exist, and that is now a property of where they live
instead of a defect.

| | what it was |
|---|---|
| `errors-v0/` | Fourteen hand-written error pages describing `sentori.track()`, `POST /v1/track:batch`, and an `st_pk_` / `sk_` token split. None of it ever reached v1; the files were untouched from the initial commit. The current catalogue is generated — [`../errors.md`](../errors.md). |
| `web-sdk/` | Guides for React, Next.js, Remix, Vite and Redux/Zustand. Their packages (`@goliapkg/sentori-react` and friends) left the repository with the v1 redesign and are not on npm; they spoke the v0.2 wire format, which this server answers with `400 invalid_payload`. |
| `unbuilt/` | Two recipes for things that were designed and not built: `sentori.startSpan` (no such export) and four external issue-tracker adapters (no route, no table, no migration). |
| `insight/` | Version-by-version upgrade notes for one integrator, from 0.7.2 to 1.0. Useful history, not documentation. |
| `sdk-react-native-v0.md` | The pre-v1 SDK reference. It said so itself; it now lives where that is enforced. The current one ships with the package: [`sdk/react-native/README.md`](../../sdk/react-native/README.md). |

If you are reading one of these because a search brought you here: the
current entry points are [`docs/README.md`](../README.md) and
[`/llms.txt`](../../webapp/public/llms.txt) on a running instance.
