# Sentori Example

Expo app for testing `@sentori/react-native` end-to-end against the local
sentori-server.

## Setup

Start the server (terminal 1):

```bash
cd ../../../server
SENTORI_DEV_TOKEN=st_pk_dev0000000000000000000000 cargo run
```

Start the example (terminal 2):

```bash
bun install        # already done if you ran it
bun run ios        # iOS simulator
# or
bun run android    # Android emulator
```

## What to test

Tap any button in the app — the corresponding event should appear in the
sentori-server stdout (pretty-printed JSON).

| Button | What it does |
|---|---|
| `Throw TypeError` | Triggers an uncaught `TypeError` — caught by `ErrorUtils.setGlobalHandler` |
| `Unhandled promise rejection` | `Promise.reject(...)` — caught by Hermes promise tracker |
| `Manual sentori.captureError(...)` | Direct `captureError` call with custom tags |
| `fetch failure → breadcrumb + capture` | Failed fetch leaves a `net` breadcrumb, then `captureError` |

## Network notes

- iOS simulator: ingest URL is `http://localhost:8080`
- Android emulator: ingest URL is `http://10.0.2.2:8080` (loopback to host)

`app.json` allows local cleartext networking on both platforms (`NSAllowsLocalNetworking` for iOS, `usesCleartextTraffic` for Android).
