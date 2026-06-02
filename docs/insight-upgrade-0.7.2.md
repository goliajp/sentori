# Sentori SDK upgrade note — for Insight

Coordinated family bump pushed to npm today. Insight only needs the
React Native package; the others ride along automatically through
peer dependencies.

```sh
bun add @goliapkg/sentori-react-native@0.7.2
```

That single command upgrades:

| package                            | from   | to     |
| ---------------------------------- | ------ | ------ |
| `@goliapkg/sentori-react-native`   | 0.7.1  | 0.7.2  |
| `@goliapkg/sentori-core`           | 0.6.0  | 0.7.0  |

After the install:

```sh
bun install         # picks up the new lockfile
# rebuild your native bundle as usual — no Pod or Gradle change required
```

---

## What's new

### 1. Non-`Error` throws don't collapse to `[object Object]`

JS code that did `Promise.reject({code: 'auth/expired'})` or
`throw {foo: 1}` used to land in the dashboard as the literal text
`[object Object]` — the SDK wrapped the rejection with
`new Error(String(value))`, which is `String({foo:1}) === '[object Object]'`.

`@goliapkg/sentori-core@0.7.0` adds a shared `coerceError(unknown)`
helper that the RN SDK now uses on every capture path. Behaviour:

| thrown value                  | dashboard renders                                  |
| ----------------------------- | -------------------------------------------------- |
| `Error` instance              | unchanged                                          |
| `string`                      | unchanged                                          |
| `{name, message}` (plain obj) | `message` shown, `error.name` becomes the type     |
| `{foo: 1}` (plain obj)        | `{"foo":1}` as the message                         |
| `42` / `true` / `null` / etc. | `Non-Error thrown: 42` (etc.)                      |
| circular / BigInt / Symbol    | `NonSerializableError` with a printable repr       |

No app-code change needed for this — once Insight is on 0.7.2 every
new event preserves the real payload.

### 2. Deprecation warning on screenshot capture is gone

`screenshot.ts` used to await
`InteractionManager.runAfterInteractions(...)` before snapshotting.
RN 0.74+ marks `InteractionManager` deprecated and points to
`requestIdleCallback`, which RN doesn't actually expose, so the
warning was unactionable.

The wait wasn't load-bearing — `captureException` always fires
between user actions, so the gesture-batch-drain semantics never
came into play — so 0.7.2 just drops the call. The existing
`requestAnimationFrame` chain still guarantees one paint commit
before the screenshotter snaps. No visual / timing change.

---

## How to turn screenshots on (was opt-in already, mentioning for completeness)

Inside Insight's `initSentori({...})` call, set
`capture.screenshot: true`:

```ts
import { initSentori } from '@goliapkg/sentori-react-native'

initSentori({
  token: 'st_pk_…',
  release: `insight@${version}`,
  environment: __DEV__ ? 'dev' : 'prod',

  capture: {
    globalErrors: true,
    promiseRejections: true,
    sessions: true,

    screenshot: true,       // ← enable
    sessionTrail: true,     // optional — last 30 nav / breadcrumb steps
  },

  sampling: {
    errors: 1.0,
    traces: 0.1,            // server-side budget recommendation
  },
})
```

Native peer required (one-time install, drops a `useNativeModules`
pod):

```sh
bun add react-native-view-shot
# iOS
cd ios && pod install && cd ..
```

If `react-native-view-shot` isn't installed, screenshot capture
silently no-ops — no crash, no thrown error — so you can land the
config first and roll out the peer at your own cadence.

### Masking sensitive UI before the shot

Wrap PII surfaces (account numbers, tokens, profile names) in
`<MaskRegion>`. While the screenshot is being captured the SDK
flips a black overlay over the wrapped subtree; the children render
normally the rest of the time.

```tsx
import { MaskRegion } from '@goliapkg/sentori-react-native'

;<View>
  <Text>Hello</Text>
  <MaskRegion>
    <Text>{user.email}</Text>           // covered in the screenshot
    <Text>card ending in {last4}</Text> // covered in the screenshot
  </MaskRegion>
</View>
```

For dynamic subtrees that can't easily wrap (e.g. a
`react-native-camera` viewfinder), use the imperative API and pass
a ref:

```ts
import { setMaskedNode, unsetMaskedNode } from '@goliapkg/sentori-react-native'

useEffect(() => {
  if (viewRef.current) {
    setMaskedNode(viewRef.current)
    return () => unsetMaskedNode(viewRef.current)
  }
}, [])
```

### What the dashboard shows after capture

`app.sentori.golia.jp` → that issue's detail page → Stack tab.
SDK-uploaded attachments render under the stack in this order:

1. **Screenshot** — thumbnail; click to view full size.
2. **View tree** — captured React tree at error time; click any
   node to highlight the matching stack frame in the trace.
3. **Session trail** — last 30 steps (route changes + custom
   `captureStep(...)` breadcrumbs) leading up to the crash, in
   a scrubbable timeline.

Disable individual capture features by setting the corresponding
`capture.*` flag to `false`; everything is opt-in by default
except the global error / rejection hookers.

---

## Other recent dashboard improvements (no SDK action needed)

These already work for Insight's existing events as of today's
deploy:

* **Email-client master/detail** on `/issues` — narrow rail on the
  left, detail rendering inline on the right; no full-screen jumps.
  URL `?status=` persists the active tab.
* **Clickable stack frames** — every frame is clickable; opens a
  right-side drawer with the full file source (±5 / ±20 / ±50
  context). Throw line is tinted red. `↗ src` link on each frame
  jumps to the configured GitHub line.
* **No-sourcemap UX** — when the release has no source map
  uploaded, the drawer still shows the function name, file:line:col,
  frame role, and `↗ src` link; only the source body is replaced
  with a contextual hint (dev build vs. missing map vs. server
  error).
* **Cmd-K palette** — `⌘K` or `/` anywhere opens a fuzzy search
  across issues / projects / orgs / teams / members.

---

If anything looks off after the upgrade — or you'd like
screenshots / view-tree / session-trail wired into specific
screens but aren't sure where to start — ping back and I'll send a
PR against the Insight repo.
