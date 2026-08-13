# Sentori for Kotlin

Error, warning and push capture for Android apps, with no React Native.

```kotlin
dependencies {
    implementation("jp.golia.sentori:sentori:1.5.0")
}
```

`minSdk 24`, JVM target 17. Apache-2.0 OR MIT.

The package is `com.sentori`, which is **not** the groupId:

```kotlin
import com.sentori.Sentori
import com.sentori.SentoriConfig
```

`jp.golia.sentori` identifies the artifact on Maven Central and
appears nowhere in the code. Guessing an import from it gives
`Unresolved reference 'jp'` on a dependency that resolved perfectly —
a combination that sends people looking at `mavenCentral()` and
transitive dependencies when the problem is one line. This section
exists because that happened.

## Start

```kotlin
import com.sentori.Sentori
import com.sentori.SentoriConfig

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Sentori.start(
            SentoriConfig(
                token = "st_…",                          // Settings ▸ Tokens, ingest scope
                ingestUrl = "https://sentori.golia.jp",
                release = "com.example.app@1.5.0+220",
                environment = "production",
            ),
            context = this,
        )
        Sentori.user(id = currentUser.id, email = null)
    }
}
```

Nothing here reaches the network — the first request happens when
there is something to send. The `Context` is used for one thing: the
directory events spill into when the network is gone. Pass the
application context, not an Activity.

Verbs called before `start` are no-ops that still return an id, so a
mis-wired token gives you a silent SDK rather than an exception on a
path you did not know you had.

`release` is what a symbolicated stack is matched against. Use the
same string your ProGuard mapping upload uses.

## The five verbs

```kotlin
Sentori.error(e)                       // what went wrong?
Sentori.warn("checkout.slow")          // where did the user struggle?
Sentori.trace("cart.opened")           // what happened here?
Sentori.assert("total.positive", ok)   // should this hold?
Sentori.probe("SEN-482")               // is that bug back?
```

Every one is synchronous, returns the event id it minted, and never
throws. They do O(1) work on the calling thread — an append under a
lock — and everything expensive happens on a background thread. If the
network is gone, events spill to disk and drain on the next launch.

Three have a behaviour worth knowing:

- **`assert` never stops the program.** That is the difference from
  the language's own `assert` and the reason this one is safe to leave
  in a release build. A *passing* assert never becomes an event
  either — it increments a counter that rides the next batch, so a
  liveness check costs no request. Only failures are events.
- **`trace(name, quiet = true)`** lands in the signal ring and stays
  out of the event stream, which is how a high-frequency breadcrumb
  stays affordable.
- **`probe`** is a tripwire. Reaching the call is the signal; it
  changes no control flow and returns no verdict.

Errors carry a real stack — up to 50 frames of class, method, file and
line:

```kotlin
try { checkout() } catch (e: Exception) {
    Sentori.error(e, mapOf("cartId" to cart.id))
}
```

## Context

```kotlin
Sentori.context(mapOf("tenant" to "acme", "plan" to "pro"))
Sentori.pushSignal("nav", mapOf("to" to "/checkout"))
```

The signal ring is the last sixty seconds of what the user was doing,
shipped inside an error so the crash has a lead-up. Any kind is
accepted. The dashboard reads `http` as `{ method, url, status, ms }`
and `trace` as a quiet breadcrumb.

This SDK deliberately does **not** install an OkHttp interceptor.
Watching your traffic is your decision, not ours to make silently —
push an `http` signal from your own interceptor if you want it. For
the same reason the SDK uses `HttpURLConnection` rather than OkHttp:
its own requests must not travel through the interceptors you
installed for yours, where a crash report could be logged, retried or
blocked by rules written for something else.

## Identity

`Sentori.user(id, email)` sends a SHA-256 of the id (or of the email
when there is no id). The raw values never leave the device, and the
hash is byte-identical to the one the iOS and React Native SDKs
compute — the three are pinned to shared vectors, because a device
that hashed differently would stop matching its own events and nothing
would report it.

It is what makes a device reachable from an issue. Without it a
registered device receives broadcasts only, and Settings ▸ Push shows
that as "N devices, 0 addressable".

## Push

The full signature, because it is a different shape from the Swift
one — two parameters, and a callback rather than a return value:

```kotlin
SentoriPush.register(
    context: Context,
    activity: Activity? = null,   // null skips the prompt and uses what is granted
    timeoutMs: Long = 8_000,      // how long to wait for a token, not for the user
    onMessage: ((Map<String, Any?>) -> Unit)? = null,
    onTap: ((Map<String, Any?>) -> Unit)? = null,
    completion: (Result) -> Unit,
)
```

Swift's is `await Sentori.push.register(onMessage:onTap:) -> Result`.
Android needs the `Context` for storage and the `Activity` to show the
Android 13+ prompt on, and reports through a callback because the
work spans a dialog.

`timeoutMs` is a network budget. Waiting for someone to read a
permission dialog is a different question and has its own budget,
`SentoriPush.permissionTimeoutMs` (two minutes by default) — a person
does not answer a prompt in the eight seconds it is reasonable to
wait for FCM.

In use:

```kotlin
Sentori.push.register(
    context = this,
    activity = this,                      // for the Android 13+ prompt
    onMessage = { payload -> … },         // arrived while in the foreground
    onTap = { data -> … },                // the user opened it
) { result ->
    if (result is SentoriPush.Result.Failure) {
        // result.reason is PERMISSION_DENIED, NO_TRANSPORT,
        //   TOKEN_TIMEOUT, SERVER_REJECTED or NOT_INITIALISED
    }
}
```

Call `Sentori.user` first if the device should be addressable. The
callback runs on a background thread.

`register` never throws, and is safe to call on every launch: Android
returns its cached permission decision without re-prompting and the
server upserts the token. Each failure asks for something different:

| `reason` | what happened | what to do |
|---|---|---|
| `PERMISSION_DENIED` | the user said no | nothing now. Offer it again from a settings screen — do **not** retry on a timer |
| `NO_TRANSPORT` | no Firebase in this build, or no `google-services.json` | check the build; nothing to do at runtime |
| `TOKEN_TIMEOUT` | FCM never returned a token | retrying later is reasonable |
| `SERVER_REJECTED` | Sentori answered non-2xx | look at Settings ▸ Push |
| `NOT_INITIALISED` | `Sentori.start` has not run | a wiring bug |

### A revocation is not a tombstone

Registering again with the same provider token brings the same row
back, and the handle does not change. That is on purpose: the two
things that revoke a device are the provider reporting its token dead
and the device revoking itself, and a device that registers again is
answering both — it is here, with a token the provider has just
issued it. Nothing an operator decided is being undone; there is no
third way to revoke.

What changes is the trail. The reason a device was quarantined is
dropped when it comes back, and `revived_at` is stamped instead — a
live device should not be described by the failure that killed a
token it no longer has.

The one case where the handle *does* change is `unregister`, which
clears the local handle too, so the next `register` arrives with a
fresh provider token and starts a new row.

### Taps, and what still needs you

A notification Sentori posted carries a pending intent of its own, so
`onTap` fires on its own — cold start or warm, nothing to wire up.
That is the path the Sentori server produces: it sends `data`
messages, and the SDK draws the tray entry itself.

Two cases are not ours to close:

- **A `notification` message from another sender.** The system draws
  it and never calls our service. A cold start still works — `register`
  reads the intent the Activity was launched with — but a tap while
  the app is already running goes to your `onNewIntent`, and only you
  can see it. One line closes it:

  ```kotlin
  override fun onNewIntent(intent: Intent) {
      super.onNewIntent(intent)
      SentoriNotificationTap.consume(intent.extras)
  }
  ```

  Safe with any intent: an ordinary launch is not a tap and is
  ignored, and the same tap is never reported twice. This paragraph
  used to end at "only you can see it", while the object it names was
  `internal` and could not be called at all — leaving
  `handleNotificationTap`, which records whatever it is handed,
  including launches that were never taps.
- **A data message with no `title` and no `body`.** Nothing is drawn,
  on purpose: an app that uses silent data messages should not get a
  notification per message. `onMessage` still fires.

`Sentori.push.unregister(context)` revokes it: the local handle is
cleared, the provider token is deleted, and the server marks the
device revoked so nothing more is sent to it.

`cachedDeviceHandle(context)` returns the handle without a round trip.

### The handle changes

Registering again after an `unregister` produces a **new** handle. The
old one is revoked, not resumed — a rotation is a retirement and a new
row, so anything you stored keyed on the old handle is stale from that
moment.

Calling `register` on every launch, which is safe and cheap, means the
callback always hands you the current one. If you store it instead,
overwrite on every `Result.Success` rather than only when you have
none.

Push needs Firebase in your app. The SDK declares
`firebase-messaging` as `compileOnly`, so an app that does not use
push does not ship it; an app that does adds the dependency, the
Google Services plugin and `google-services.json` as it would anyway.

### If your app also uses another FCM library

Android delivers `onNewToken` and `onMessageReceived` to whichever
service matching `com.google.firebase.MESSAGING_EVENT` manifest
merging placed first. Two such services in one APK means one of them
is deaf, and which one is decided at build time — no runtime flag can
reach it.

This SDK declares `com.sentori.SentoriFirebaseMessagingService`. If
another library should own delivery, remove ours from the merged
manifest:

```xml
<service android:name="com.sentori.SentoriFirebaseMessagingService"
         tools:node="remove" />
```

## What it costs you

The contract this SDK is written against is that adopting it is free:

- verbs never throw and never block the caller
- the in-memory queue is bounded at 500 events, the spill file at 1000
- a failure inside Sentori — a bad token, a dead server, a full disk —
  never becomes your failure
- `firebase-messaging` is `compileOnly`, so push costs nothing to an
  app that does not use it

If you ever measure Sentori costing your app something a user could
feel, that is a bug worth reporting as a P0.

## Also in the box

An uncaught exception is written to disk as the app dies, along with a
screenshot of the last frame and the view tree behind it. The next
`Sentori.start` sends the crash, and once the server has taken it,
uploads the two blobs against it — in that order, because an
attachment keyed on an event the server has not seen is a 404.

Nothing here needs configuring. The ANR watchdog and mobile vitals are
compiled in and driven by the React Native SDK today; they are not yet
part of this public surface.
