# @goliapkg/sentori-react-native

React Native SDK for [Sentori](https://sentori.golia.jp) — the
self-hosted crash + warning monitor for mobile apps. JS layer +
iOS Swift + Android Kotlin native, distributed as an Expo module
(works on bare RN too).

Eight verbs are the whole API. Every one is synchronous, returns
immediately, and can never throw into your app.

Upgrading from 4.x? See [MIGRATION.md](./MIGRATION.md).

## Install

```sh
bun add @goliapkg/sentori-react-native
cd ios && pod install --repo-update
```

## Use

```tsx
import { sentori } from '@goliapkg/sentori-react-native'

sentori.init({
  token: 'st_…',                        // ingest token, Settings → Tokens
  ingestUrl: 'https://sentori.example.com',
  release: 'my-app@1.2.3',
  environment: 'prod',
})

sentori.user({ id, email, name })        // drives breadth × depth stats
sentori.context({ tenant: 'acme' })      // ambient tags on every event

sentori.error(new Error('boom'))         // what broke
sentori.warn('pay.gateway-retry', data)  // where users hurt
sentori.trace('checkout.start', data)    // what happened
sentori.assert('total-positive', ok)     // what should hold (never halts)
sentori.probe('BUG-123', data)           // did that bug come back
```

Auto-wired (no configuration):

- JS `error` / `unhandledrejection` global hooks
- iOS `NSException` + Android uncaught-exception handlers
- Warn scenario detectors: rage taps, long freezes, slow cold start
  (slow API stays opt-in) — tune with `init({ detect })`
- Signal ring: recent taps, navigation, traces ride along on every
  error/warn as the "what the user was doing" timeline
- B-type replay: rolling wireframe buffer, shipped only when an
  error/warn actually fires (`init({ replaySeconds })`)

Identity is hashed on-device with a salted hash — the server never
sees the raw email.

## React extras

```tsx
import {
  ErrorBoundary,        // React idiom for the error verb
  RageTapCapture,       // wrap your root to feed the rage-tap detector
  useTraceNavigation,   // pass your react-navigation ref
} from '@goliapkg/sentori-react-native'
```

## Build pipeline

`@goliapkg/sentori-cli` uploads sourcemaps (failures never block a
release — friendly notice, exit 0) and registers `probe()`
tripwires per release. See MIGRATION.md §6.

## License

Dual-licensed under [Apache-2.0](../../LICENSE-APACHE) OR
[MIT](../../LICENSE-MIT).
