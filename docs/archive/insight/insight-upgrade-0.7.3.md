# Sentori SDK upgrade note — for Insight (0.5.7 → 0.7.3)

Insight is currently on `sentori-react-native@0.5.7`. v0.7.3 ships
today and is the recommended target — it folds in everything from
the five intervening releases plus today's mask redesign.

```sh
bun add @goliapkg/sentori-react-native@0.7.3
bun install
# rebuild your native bundle as usual — no Pod or Gradle change
# required, and **no extra peer dep** since v0.7.3 dropped the
# `react-native-view-shot` requirement.
```

That single command upgrades:

| package                          | from   | to     |
| -------------------------------- | ------ | ------ |
| `@goliapkg/sentori-react-native` | 0.5.7  | 0.7.3  |
| `@goliapkg/sentori-core`         | 0.5.x  | 0.7.0  |

If you previously installed `react-native-view-shot` for Sentori,
you can remove it:

```sh
bun remove react-native-view-shot
```

It's now unused — v0.7.3 captures screenshots through the SDK's own
native module instead.

---

## TL;DR — what landed between 0.5.7 and 0.7.3

| since | feature                                          | opt-in?      |
| ----- | ------------------------------------------------ | ------------ |
| 0.6.0 | Screenshot capture on `captureException`         | yes          |
| 0.7.0 | Client-side sampling (`sampling.errors / traces`)| yes          |
| 0.7.0 | Session trail (last N nav / breadcrumb steps)    | yes          |
| 0.7.0 | Manual breadcrumbs via `captureStep(...)`        | always on    |
| 0.7.2 | `coerceError` — no more `[object Object]` events | always on    |
| 0.7.2 | `InteractionManager` deprecation warning gone    | always on    |
| 0.7.3 | Mask redesign — `registerMaskQuery`              | yes (if you use screenshots) |
| 0.7.3 | No more `react-native-view-shot` peer dep        | always on    |

Everything labelled "always on" works after the version bump with
no config change. The "opt-in" items are walked through below.

---

## 1. Screenshot capture — full onboarding (was disabled in 0.5.7)

The 0.6.0 → 0.7.3 work made `capture.screenshot: true` ready for
production. Here's the full picture for Insight.

### 1a. Enable in init

```ts
// app/src/core/bootstrap/scripts/sentori.ts (or wherever
// `initSentori` is called today)
import { initSentori } from '@goliapkg/sentori-react-native'

initSentori({
  token: 'st_pk_…',
  release: `insight@${version}`,
  environment: __DEV__ ? 'dev' : 'prod',

  capture: {
    globalErrors: true,
    promiseRejections: true,
    sessions: true,

    screenshot: true,        // ← enable
    sessionTrail: true,      // ← optional, see §2
  },

  sampling: {
    errors: 1.0,             // see §3
    traces: 0.1,
  },
})
```

That's it for the boot wiring. No peer dep, no Pod, no Gradle.

What ships on each `captureException`:

- a 480 px (long edge) JPEG (iOS) / WEBP_LOSSY (Android 11+) /
  JPEG (Android 7-10), q≈70, typically 30-100 KB
- multipart-attached to `POST /v1/events/<id>/attachments/screenshot`
  alongside the event
- visible in the dashboard at `app.sentori.golia.jp` → issue detail
  → Stack tab → thumbnail

If the capture fails for any reason — backgrounded app, race with
teardown, native render rejected — the error event still ships;
the screenshot just isn't attached.

### 1b. Redacting PII regions (this is the v0.7.3 change)

The old `<MaskRegion>` component is gone (it was never exposed to
Insight since you skipped 0.6 → 0.7.2, so there's nothing to
migrate away from — you go straight to the new pattern).

**The new model**: Insight owns a registry of masked native-IDs;
the SDK reads from it once per capture via a callback you register
at boot.

The reference `Maskable` lives in your app code (it does not
import from the SDK):

```tsx
// app/src/core/observability/mask.tsx
import { useEffect, useRef } from 'react'
import { View, type ViewProps } from 'react-native'

const PREFIX = 'mask'
const registry = new Set<string>()

export function getMaskedNativeIds(): string[] {
  return Array.from(registry)
}

export function Maskable({
  children,
  ...rest
}: ViewProps & { children?: React.ReactNode }) {
  const idRef = useRef(`${PREFIX}-${Math.random().toString(36).slice(2, 10)}`)
  useEffect(() => {
    const id = idRef.current
    registry.add(id)
    return () => {
      registry.delete(id)
    }
  }, [])
  return (
    <View collapsable={false} nativeID={idRef.current} {...rest}>
      {children}
    </View>
  )
}
```

Wire the query to the SDK in one place (next to `initSentori`):

```ts
// app/src/core/bootstrap/scripts/sentori.ts
import { sentori } from '@goliapkg/sentori-react-native'
import { getMaskedNativeIds } from '@/core/observability/mask'

sentori.registerMaskQuery(getMaskedNativeIds)
```

Now any UI that wants to hide content from screenshots uses
`<Maskable>` — and never imports anything from the SDK:

```tsx
// somewhere deep in a feature module
import { Maskable } from '@/core/observability/mask'

;<View>
  <Text>Hello {user.firstName}</Text>
  <Maskable>
    <Text>{user.email}</Text>
    <Text>card ending in {last4}</Text>
  </Maskable>
  <Maskable className="absolute inset-0">
    <CameraPreview />
  </Maskable>
</View>
```

In the captured screenshot each `Maskable` subtree is painted as a
solid black rectangle by the native module. The user never sees
any flicker because the redaction happens on the captured bitmap,
not on the live UI.

If `registerMaskQuery` was never called, no mask is applied — the
SDK does nothing unless told to.

### 1c. Why the design changed in 0.7.3

The earlier `<MaskRegion>` exported a React component from the
SDK, which meant every PII-bearing UI file had to import from
`@goliapkg/sentori-react-native`. A logging SDK on the render path
can break the host app's UI (it has, see the NativeWind
`<View collapsable={false}>` className regression we hit). The
0.7.3 contract — consumer owns the registry, SDK only reads from
it on capture — keeps the SDK off the render tree and makes it
swappable / removable / lazy-initializable without touching UI
code.

---

## 2. Session trail (added in 0.7.0)

When `capture.sessionTrail: true` is set, the SDK keeps a rolling
buffer of the last 30 events — route changes, `captureStep(...)`
custom marks, and breadcrumbs — and ships it alongside each
`captureException` as a `sessionTrail` attachment.

```ts
import { captureStep } from '@goliapkg/sentori-react-native'

// inside any flow you want to mark
captureStep('checkout/payment-method-selected', { method: 'card' })
captureStep('camera/permission-prompt-shown')
```

In the dashboard it renders as a scrubbable timeline on the issue
detail page. No native peer needed.

---

## 3. Sampling (added in 0.7.0)

```ts
initSentori({
  // …
  sampling: {
    errors: 1.0,   // 0–1; keep all errors during onboarding
    traces: 0.1,   // 10 % of traces — recommended once at user volume
  },
})
```

`errors` is per-event; `traces` decides per-trace (all spans
together) so a sampled trace still arrives intact. Either may be
`null` / absent → keep everything.

If Insight is still pre-prod or low-volume, `traces: 1.0` is fine.
Bump the budget down once you start hitting ingest quota — no
server change required, decisions are made client-side.

---

## 4. No-action wins (already live after the install)

These come for free:

### `coerceError` — non-Error throws no longer collapse

JS code that did `Promise.reject({ code: 'auth/expired' })` or
`throw { foo: 1 }` used to land in the dashboard as the literal
text `[object Object]`. v0.7.2 fixed this at the source:

| thrown value                  | dashboard renders                          |
| ----------------------------- | ------------------------------------------ |
| `Error` instance              | unchanged                                  |
| `string`                      | unchanged                                  |
| `{name, message}` (plain obj) | `message` shown, `name` becomes error type |
| `{foo: 1}` (plain obj)        | `{"foo":1}` as the message                 |
| `42` / `true` / `null` / etc. | `Non-Error thrown: 42`                     |
| circular / BigInt / Symbol    | `NonSerializableError` with printable repr |

Existing events captured pre-0.7.2 stay as they were; only new
events benefit.

### `InteractionManager` deprecation warning gone

The "InteractionManager is deprecated, use requestIdleCallback"
print that landed on RN 0.74+ — that came from the SDK. v0.7.2
removed the dead `runAfterInteractions` await; capture timing is
unchanged.

---

## 5. Recap — what to do in Insight

1. `bun add @goliapkg/sentori-react-native@0.7.3 && bun install`
2. `bun remove react-native-view-shot` (no longer needed)
3. Add `capture: { screenshot: true, sessionTrail: true }` to
   `initSentori`
4. Drop the `Maskable` helper file in §1b and wire
   `sentori.registerMaskQuery(getMaskedNativeIds)` next to init
5. Wrap any PII surface with `<Maskable>`
6. Rebuild and ship — `app.sentori.golia.jp` shows screenshots +
   session trail on the next error

---

If anything looks off after the upgrade — bad mask rects, missing
screenshots, capture timing concerns — ping back with the issue
ID from the dashboard and I'll dig in.
