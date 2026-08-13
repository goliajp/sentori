# Sentori for Swift

Error, warning and push capture for iOS apps, with no React Native.

```swift
.package(url: "https://github.com/goliajp/sentori-swift", from: "1.5.0")
```

iOS 14+. Apache-2.0 OR MIT.

## Start

```swift
import Sentori

Sentori.start(
    SentoriConfig(
        token: "st_…",                       // Settings ▸ Tokens, ingest scope
        ingestUrl: "https://sentori.golia.jp",
        release: "com.example.app@1.5.0+220",
        environment: "production"
    )
)
Sentori.user(id: currentUser.id, email: nil)
```

Nothing here reaches the network — the first request happens when
there is something to send. Call it once, early; verbs called before
it are no-ops that still return an id, so a mis-wired token gives you
a silent SDK rather than an exception on a path you did not know you
had.

`release` is what a symbolicated stack is matched against. Use the
same string your dSYM upload uses.

## The five verbs

```swift
Sentori.error(err)                    // what went wrong?
Sentori.warn("checkout.slow")         // where did the user struggle?
Sentori.trace("cart.opened")          // what happened here?
Sentori.assert("total.positive", ok)  // should this hold?
Sentori.probe("SEN-482")              // is that bug back?
```

Every one is synchronous, returns the event id it minted, and never
throws. They do O(1) work on the calling thread — an append under a
lock — and everything expensive happens on a background queue. If the
network is gone, events spill to disk and drain on the next launch.

Three of them have a behaviour worth knowing:

- **`assert` never stops the program.** That is the difference from
  the language's own `assert` and the reason this one is safe to leave
  in a release build. A *passing* assert never becomes an event
  either — it increments a counter that rides the next batch, so a
  liveness check costs no request. Only failures are events.
- **`trace(_:quiet:)`** always lands in the signal ring; `quiet: true`
  keeps it out of the event stream, which is how a high-frequency
  breadcrumb stays affordable.
- **`probe`** is a tripwire. Reaching the call is the signal; it
  changes no control flow and returns no verdict.

Any of them takes `data:`:

```swift
Sentori.warn("checkout.slow", data: ["ms": 3200, "cartId": cart.id])
```

## Context

```swift
Sentori.context(["tenant": "acme", "plan": "pro"])   // rides every event
Sentori.pushSignal(kind: "nav", data: ["to": "/checkout"])
```

The signal ring is the last sixty seconds of what the user was doing,
shipped inside an error so the crash has a lead-up. Any `kind` is
accepted. The dashboard reads `http` as
`{ method, url, status, ms }` and `trace` as a quiet breadcrumb.

This SDK deliberately does **not** swizzle `URLSession`. Watching your
traffic is your decision, not ours to make silently — push an `http`
signal from your own interceptor if you want it.

## Identity

`Sentori.user(id:email:)` sends a SHA-256 of the id (or of the email
when there is no id). The raw values never leave the device.

It is what makes a device reachable from an issue: with it, "notify
the people who hit this" is a join. Without it a registered device
receives broadcasts only, and Settings ▸ Push shows that as
"N devices, 0 addressable" — the one symptom with no other
explanation.

## Push

```swift
let result = await Sentori.push.register(
    onMessage: { payload in … },   // arrived while in the foreground
    onTap:     { data in … }       // the user opened it
)

if case .failure(let reason, let message) = result {
    // reason is .permissionDenied, .noTransport, .tokenTimeout,
    //           .serverRejected or .notInitialised
}
```

Call `Sentori.user` first if the device should be addressable.

`register` never throws, and is safe to call on every launch: iOS
returns its cached permission decision without re-prompting and the
server upserts the token. Each failure asks for something different:

| `reason` | what happened | what to do |
|---|---|---|
| `permissionDenied` | the user said no | nothing now. Offer it again from a settings screen — do **not** retry on a timer |
| `noTransport` | no push entitlement in this build | check the build; nothing to do at runtime |
| `tokenTimeout` | the OS never returned a token | usually provisioning. Retrying later is reasonable |
| `serverRejected` | Sentori answered non-2xx | look at Settings ▸ Push |
| `notInitialised` | `Sentori.start` has not run | a wiring bug |

`Sentori.push.unregister()` revokes it: the local handle is cleared,
the device is unregistered with APNs, and the server marks it revoked
so nothing more is sent to it. `cachedDeviceHandle()` returns the
handle without a round trip.

Registering again produces a **new** handle. The old one is revoked,
not resumed — a rotation is a retirement and a new row, so anything
stored against the old handle is stale from that moment. Calling
`register` on every launch, which is safe and cheap, means you always
hold the current one.

Your app still needs the `aps-environment` entitlement and the
`remote-notification` background mode; the SDK does not add
capabilities to your target.

## What it costs you

The contract this SDK is written against is that adopting it is free:

- verbs never throw and never block the caller
- the in-memory queue is bounded at 500 events, the spill file at 1000
- a failure inside Sentori — a bad token, a dead server, a full disk —
  never becomes your failure
- values that cannot be encoded are replaced, not dropped, and never
  raise

If you ever measure Sentori costing your app something a user could
feel, that is a bug worth reporting as a P0.

## Also in the box

An uncaught `NSException` is written to disk as the app dies, along
with a screenshot of the last frame and the view tree behind it. The
next `Sentori.start` sends the crash, and once the server has taken
it, uploads the two blobs against it — in that order, because an
attachment keyed on an event the server has not seen is a 404.

Nothing here needs configuring. The hang watchdog, thread sampler and
mobile vitals are compiled in and driven by the React Native SDK
today; they are not yet part of this public surface.
