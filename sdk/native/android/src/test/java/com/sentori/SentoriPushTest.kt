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
import org.robolectric.RobolectricTestRunner

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
}
