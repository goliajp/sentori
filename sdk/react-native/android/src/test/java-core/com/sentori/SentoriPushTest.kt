// GENERATED MIRROR — do not edit.
// Source of truth: sdk/native/android/src/test/java/com/sentori/SentoriPushTest.kt
// Run `node scripts/sync-native-core.mjs` after editing it.
package com.sentori

import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Push registration, as far as Robolectric can go.
 *
 * There is no FCM on the classpath here and no Google Play services,
 * so the honest coverage is the shape of the failures and the shape of
 * the request — not a real token. `scripts/android-live-ingest.sh`
 * proves the ingest route against a real server; a device proves the
 * rest, and nothing here pretends otherwise.
 *
 * Deliberately the same assertions as `SentoriPushTests.swift`.
 */
@RunWith(RobolectricTestRunner::class)
class SentoriPushTest {

    private val context get() = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Before
    fun setUp() {
        SentoriConfig.resetForTests()
        SentoriScope.clear()
        SentoriPush.resetForTests()
    }

    @After
    fun tearDown() {
        SentoriConfig.resetForTests()
        SentoriPush.resetForTests()
    }

    private fun registerBlocking(timeoutMs: Long = 1_000): SentoriPush.Result {
        val latch = CountDownLatch(1)
        var result: SentoriPush.Result? = null
        SentoriPush.register(context, activity = null, timeoutMs = timeoutMs) {
            result = it
            latch.countDown()
        }
        assertTrue("register never called back", latch.await(30, TimeUnit.SECONDS))
        return result!!
    }

    @Test
    fun registerBeforeStartReportsItRatherThanThrowing() {
        val r = registerBlocking()
        assertTrue("expected a failure before start, got $r", r is SentoriPush.Result.Failure)
        assertEquals(
            SentoriPush.Failure.NOT_INITIALISED,
            (r as SentoriPush.Result.Failure).reason,
        )
        assertEquals("not-initialised", r.reason.reason)
    }

    @Test
    fun everyFailureHasTheSameNameAsTheOtherTwoSdks() {
        // Same strings as `PushRegisterFailure` in React Native and
        // `SentoriPush.Failure` in Swift, so one set of integration
        // notes covers all three.
        assertEquals("not-initialised", SentoriPush.Failure.NOT_INITIALISED.reason)
        assertEquals("permission-denied", SentoriPush.Failure.PERMISSION_DENIED.reason)
        assertEquals("no-transport", SentoriPush.Failure.NO_TRANSPORT.reason)
        assertEquals("token-timeout", SentoriPush.Failure.TOKEN_TIMEOUT.reason)
        assertEquals("server-rejected", SentoriPush.Failure.SERVER_REJECTED.reason)
    }

    @Test
    fun registerWithoutFcmFailsWithoutThrowing() {
        Sentori.start(
            SentoriConfig(
                token = "st_test",
                ingestUrl = "http://127.0.0.1:9",
                release = "app@1.0.0",
                environment = "test",
            ),
            context,
        )

        // No Firebase on the classpath, so this ends at permission or
        // at the token wait. Either is fine; reaching the end without
        // a throw and without a hang is the assertion.
        val r = registerBlocking()
        assertTrue("Robolectric cannot actually register, got $r", r is SentoriPush.Result.Failure)
        val reason = (r as SentoriPush.Result.Failure).reason
        assertTrue(
            "unexpected reason ${reason.reason}: ${r.message}",
            reason in
                listOf(
                    SentoriPush.Failure.PERMISSION_DENIED,
                    SentoriPush.Failure.NO_TRANSPORT,
                    SentoriPush.Failure.TOKEN_TIMEOUT,
                ),
        )
        assertNull("a failure must cache nothing", SentoriPush.cachedDeviceHandle(context))
    }

    /**
     * The one that was missing, and the reason a whole class of user
     * never got push.
     *
     * `requestPermission` parked its callback in a field and left it
     * to `handlePermissionResult` — a hook the host has to forward
     * from its own `onRequestPermissionsResult`, which the docs never
     * mentioned and a native host has no reason to know about. So the
     * callback was never called, `finishRegister` never ran, and a
     * first launch registered nothing: the dialog appeared, the user
     * tapped Allow, and the SDK did not continue. It worked on the
     * *next* launch, because the permission was granted by then and
     * the flow never suspended at all.
     *
     * Every test in this file passed throughout, because every one of
     * them passes `activity = null` and skips the prompt entirely.
     *
     * This one takes an Activity, never forwards the result — exactly
     * what a host that has not read the source does — and grants the
     * permission the way the framework does. What is asserted is only
     * that `register` comes back at all. Whether it then succeeds
     * needs an FCM that is not on this classpath.
     */
    @Test
    @Config(sdk = [33])
    fun registerContinuesWhenPermissionIsGrantedWithoutTheHostForwardingIt() {
        SentoriConfig.set(
            SentoriConfig(
                token = "st_test",
                ingestUrl = "http://127.0.0.1:9",
                release = "app@1.0.0",
                environment = "test",
            ),
        )
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(app).denyPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        val activity = Robolectric.buildActivity(android.app.Activity::class.java).setup().get()

        val latch = CountDownLatch(1)
        var result: SentoriPush.Result? = null
        SentoriPush.permissionTimeoutMs = 20_000
        SentoriPush.register(app, activity = activity, timeoutMs = 500) {
            result = it
            latch.countDown()
        }

        // Not registered yet: the dialog is up and nobody has answered.
        assertNull("register reported before the permission was answered", result)

        // The user taps Allow. Nothing forwards the result — this is
        // the whole point.
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        assertTrue(
            "register never came back after the permission was granted — the first " +
                "launch after a fresh install registers nothing and says nothing",
            latch.await(30, TimeUnit.SECONDS),
        )
        assertNotNull(result)
    }

    /**
     * And when nobody ever answers, it still reports rather than
     * leaving the caller with a callback that never fires.
     */
    @Test
    @Config(sdk = [33])
    fun registerReportsWhenThePermissionDialogIsIgnored() {
        SentoriConfig.set(
            SentoriConfig(
                token = "st_test",
                ingestUrl = "http://127.0.0.1:9",
                release = "app@1.0.0",
                environment = "test",
            ),
        )
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(app).denyPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        val activity = Robolectric.buildActivity(android.app.Activity::class.java).setup().get()

        val latch = CountDownLatch(1)
        var result: SentoriPush.Result? = null
        SentoriPush.permissionTimeoutMs = 1_500
        SentoriPush.register(app, activity = activity, timeoutMs = 500) {
            result = it
            latch.countDown()
        }

        assertTrue("register never gave up", latch.await(30, TimeUnit.SECONDS))
        val failure = result as? SentoriPush.Result.Failure
        assertNotNull("expected a failure, got $result", failure)
        assertEquals(SentoriPush.Failure.PERMISSION_DENIED, failure!!.reason)
    }

    @Test
    fun unregisterWithNothingRegisteredIsANoOp() {
        val latch = CountDownLatch(1)
        var ok: Boolean? = null
        SentoriPush.unregister(context) {
            ok = it
            latch.countDown()
        }
        assertTrue(latch.await(10, TimeUnit.SECONDS))
        assertEquals("nothing to revoke", false, ok)
        assertNull(SentoriPush.cachedDeviceHandle(context))
    }

    @Test
    fun theRegistrationBodyIsTheOneTheServerAccepts() {
        // The field names are the whole reason push never worked for a
        // year: the RN SDK sent `provider` where the server reads
        // `kind`, and parsed an `ipt_*` handle no server has ever
        // returned. Pinned here rather than left to a reviewer.
        SentoriScope.setUser("usr_123", null)
        val body =
            mapOf(
                "kind" to "fcm",
                "nativeToken" to "abcd",
                "userKey" to SentoriScope.userKey,
            )
        val json = org.json.JSONObject(SentoriTransport.toJson(body).toString())

        assertEquals("fcm", json.getString("kind"))
        assertTrue("the server has no such field", !json.has("provider"))
        // FCM is one host; an `env` here would be a claim about a
        // sandbox/production split that does not exist.
        assertTrue("FCM has no environment split", !json.has("env"))
        assertEquals(
            SentoriIdentity.hash("id", "usr_123"),
            json.getString("userKey"),
        )
        assertNotNull(json)
    }
    // ── taps ──────────────────────────────────────────────────────

    /**
     * The second half of the same bug as the permission one.
     *
     * `handleNotificationTap` was reachable only from the host, whose
     * own doc comment told it to forward intent extras — advice that
     * appeared nowhere a host would read. So `register(onTap:)` took
     * a callback that could never be called. insight measured it: the
     * tray entry appeared, the app opened, silence.
     *
     * Here the app is launched by a notification and the host does
     * nothing at all.
     */
    @Test
    @Config(sdk = [33])
    fun aColdStartFromANotificationDeliversTheTapWithoutTheHostForwardingIt() {
        SentoriConfig.set(
            SentoriConfig(
                token = "st_test",
                ingestUrl = "http://127.0.0.1:9",
                release = "app@1.0.0",
                environment = "test",
            ),
        )
        SentoriNotificationTap.resetForTests()
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)

        // What the system hands an Activity opened from a tap.
        val intent = android.content.Intent(app, android.app.Activity::class.java)
            .putExtra("google.message_id", "0:1786545260399414%c9712c12")
            .putExtra("title", "Crash in checkout")
        val activity = Robolectric.buildActivity(android.app.Activity::class.java, intent)
            .setup().get()

        val taps = mutableListOf<Map<String, Any?>>()
        val latch = CountDownLatch(1)
        SentoriPush.register(
            app,
            activity = activity,
            timeoutMs = 300,
            onTap = { taps.add(it) },
        ) { latch.countDown() }
        assertTrue("register never came back", latch.await(30, TimeUnit.SECONDS))

        val deadline = System.currentTimeMillis() + 10_000
        while (taps.isEmpty() && System.currentTimeMillis() < deadline) Thread.sleep(50)

        assertTrue(
            "onTap never fired for the notification that launched the app — the host " +
                "passed a callback that could not be called",
            taps.isNotEmpty(),
        )
        assertEquals("0:1786545260399414%c9712c12", taps[0]["google.message_id"])
    }

    /** An ordinary launch is not a tap. */
    @Test
    @Config(sdk = [33])
    fun anOrdinaryLaunchIsNotReportedAsATap() {
        SentoriNotificationTap.resetForTests()
        val activity = Robolectric.buildActivity(android.app.Activity::class.java).setup().get()
        val taps = mutableListOf<Map<String, Any?>>()
        SentoriPushNotifications.drainState()

        SentoriNotificationTap.consume(activity)
        val state = SentoriPushNotifications.drainState()

        @Suppress("UNCHECKED_CAST")
        val drained = state["taps"] as? List<Map<String, Any?>> ?: emptyList()
        taps.addAll(drained)
        assertTrue(
            "a launch with no notification behind it was reported as a tap, which " +
                "puts a notification in every session that never had one",
            taps.isEmpty(),
        )
    }

    /** The same tap is not reported twice. */
    @Test
    @Config(sdk = [33])
    fun oneTapIsDeliveredOnce() {
        SentoriNotificationTap.resetForTests()
        SentoriPushNotifications.drainState()
        val extras = android.os.Bundle().apply {
            putString("google.message_id", "0:dedupe-me")
            putString("title", "once")
        }

        SentoriNotificationTap.consume(extras)
        SentoriNotificationTap.consume(extras)

        @Suppress("UNCHECKED_CAST")
        val taps = SentoriPushNotifications.drainState()["taps"] as? List<Map<String, Any?>>
            ?: emptyList()
        assertEquals(
            "the launch intent is visible to more than one caller; counting it twice " +
                "turns one open into two",
            1,
            taps.size,
        )
    }

    // ── the tray ──────────────────────────────────────────────────

    /**
     * A data message the user can actually see.
     *
     * Nothing posted a notification before, so a `data` message
     * reached `onMessage` and left the tray empty — insight's device
     * said "No notifications" while the callback had fired. The
     * server sends `data` on purpose, so this is the whole visible
     * half of a push.
     */
    @Test
    @Config(sdk = [33])
    fun aDataMessageWithSomethingToShowReachesTheTray() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        val mgr = app.getSystemService(android.content.Context.NOTIFICATION_SERVICE)
            as android.app.NotificationManager
        mgr.cancelAll()

        SentoriPushNotifications.postNotification(
            app,
            mapOf("google.message_id" to "0:show-me", "title" to "Crash in checkout",
                  "body" to "3 users affected"),
        )

        val posted = shadowOf(mgr).allNotifications
        assertEquals("the user saw nothing", 1, posted.size)
        assertNotNull(
            "no pending intent, so the tap cannot come back",
            posted[0].contentIntent,
        )
    }

    /**
     * Through the service, not around it.
     *
     * The first version of the test above called `postNotification`
     * directly, so removing the call from `onMessageReceived` left it
     * green — a unit test of a function nobody calls proves the
     * function, not the feature. This drives a real `RemoteMessage`
     * into the real service.
     */
    @Test
    @Config(sdk = [33])
    fun theServiceTurnsADataMessageIntoATrayEntryAndACallback() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        val mgr = app.getSystemService(android.content.Context.NOTIFICATION_SERVICE)
            as android.app.NotificationManager
        mgr.cancelAll()
        SentoriPushNotifications.drainState()

        val service = Robolectric.buildService(SentoriFirebaseMessagingService::class.java)
            .create().get()
        val message = com.google.firebase.messaging.RemoteMessage.Builder("to@fcm")
            .setMessageId("0:through-the-service")
            .addData("sentori", "1")
            .addData("title", "Crash in checkout")
            .addData("body", "3 users affected")
            .build()

        service.onMessageReceived(message)

        assertEquals(
            "a data message left the tray empty — the user sees nothing and has " +
                "nothing to tap",
            1,
            shadowOf(mgr).allNotifications.size,
        )
        @Suppress("UNCHECKED_CAST")
        val received = SentoriPushNotifications.drainState()["notifications"]
            as? List<Map<String, Any?>> ?: emptyList()
        assertEquals(1, received.size)
    }

    /**
     * A silent data message stays silent. An app that uses data
     * messages to tell itself something would not thank us for
     * turning each one into a notification to dismiss.
     */
    @Test
    @Config(sdk = [33])
    fun aDataMessageWithNothingToShowIsNotPosted() {
        val app = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(app).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        val mgr = app.getSystemService(android.content.Context.NOTIFICATION_SERVICE)
            as android.app.NotificationManager
        mgr.cancelAll()

        SentoriPushNotifications.postNotification(app, mapOf("sync" to "inbox"))

        assertTrue(shadowOf(mgr).allNotifications.isEmpty())
    }

}
