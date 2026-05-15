Hey Insight team —

`@goliapkg/sentori-react-native@0.7.3` is out. You're still on
**0.5.7**, so this jump pulls in five releases of fixes + features
plus today's mask redesign. Worth the upgrade.

### Two-command install

```sh
bun add @goliapkg/sentori-react-native@0.7.3
bun remove react-native-view-shot   # no longer needed since 0.7.3
```

No Pod, no Gradle change. Rebuild the native bundle as usual.

### What you get for free (after the install, no config change)

- `[object Object]` events are fixed — `throw {code: 'auth/expired'}`
  or `Promise.reject({foo: 1})` now lands in the dashboard as the
  real payload, not the literal `[object Object]` string.
- The `InteractionManager is deprecated` console warning from the
  SDK is gone.

### Opt-in: turn on screenshot capture

In your `initSentori({...})` call:

```ts
capture: {
  globalErrors: true,
  promiseRejections: true,
  sessions: true,
  screenshot: true,        // ← new
  sessionTrail: true,      // ← new, last 30 nav/breadcrumb steps
}
```

Each error event will get a 480 px JPEG/WEBP (~40-100 KB)
attached, plus a scrubbable session trail.

### Opt-in: redact PII in screenshots

v0.7.3 changed the mask API — the SDK no longer exports React
components. You own a `Maskable` helper in your app, and the SDK
just reads from it once per capture.

Three pieces:

1. Drop the `Maskable` helper file (~25 lines) — copy-paste from
   `docs/insight-upgrade-0.7.3.md` §1b.
2. One line next to your `initSentori`:
   ```ts
   sentori.registerMaskQuery(getMaskedNativeIds)
   ```
3. Wrap any PII surface with `<Maskable>`:
   ```tsx
   <Maskable><Text>{user.email}</Text></Maskable>
   <Maskable className="absolute inset-0"><CameraPreview /></Maskable>
   ```

The SDK is never imported by UI files — `<Maskable>` lives in your
codebase. PII regions render normally in the live app; they show
up as solid black rectangles in the captured screenshot.

### Full migration doc

`docs/insight-upgrade-0.7.3.md` — has the copy-paste `Maskable`
helper, sampling guidance, session-trail details, and why the mask
API changed shape in 0.7.3.

Ping back if anything looks off after the upgrade — happy to send
a PR against the Insight repo for the boot wiring if that's easier.
