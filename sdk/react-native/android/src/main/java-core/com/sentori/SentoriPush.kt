// GENERATED MIRROR — do not edit.
// Source of truth: sdk/native/android/src/main/java/com/sentori/SentoriPush.kt
// Run `node scripts/sync-native-core.mjs` after editing it.
package com.sentori

import android.app.Activity
import android.content.Context
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/**
 * Push, as an app writes it.
 *
 *     Sentori.push.register(activity) { result ->
 *         if (result is SentoriPush.Result.Failure) { … }
 *     }
 *
 * The pieces underneath already existed — the POST_NOTIFICATIONS
 * prompt, the FCM service, the token and tap buffers — and were
 * reachable only through the React Native bridge. What was missing
 * everywhere but JavaScript is the part that puts a token on the
 * server, which is the only reason a registered device is reachable
 * at all.
 *
 * Asked for by insight (2026-08-11): two apps with no React Native,
 * blocked, and unwilling to reimplement the HTTP contract because a
 * second implementation drifts silently on the one path nobody
 * watches.
 *
 * Callback-based rather than suspending, so this is usable from Java
 * and from a codebase that has not adopted coroutines. The callback
 * runs on a background thread; touch UI from it at your own risk.
 */
object SentoriPush {

    /**
     * Why a registration did not produce a device handle. Same five
     * names as `PushRegisterFailure` in the React Native SDK and the
     * Swift one, so a single set of integration notes covers all
     * three and an operator reading a support thread does not have to
     * translate.
     */
    enum class Failure(val reason: String) {
        /** [Sentori.start] has not run. A wiring bug. */
        NOT_INITIALISED("not-initialised"),
        /**
         * The user said no. Not an error: do not retry on a timer,
         * and offer it again from a settings screen.
         */
        PERMISSION_DENIED("permission-denied"),
        /**
         * No Firebase in this build, or no `google-services.json`.
         * Nothing to do at runtime.
         */
        NO_TRANSPORT("no-transport"),
        /**
         * FCM never handed back a token inside the window. Retrying
         * later is reasonable.
         */
        TOKEN_TIMEOUT("token-timeout"),
        /** Sentori answered non-2xx. Settings ▸ Push is where to look. */
        SERVER_REJECTED("server-rejected"),
    }

    /**
     * Registration never throws. A denied permission is an ordinary
     * answer, and an opt-in that throws inside someone's ViewModel is
     * the failure this SDK's contract with its host is written
     * against.
     */
    sealed class Result {
        /**
         * The `device_tokens` row id. Revoking takes it, and so does a
         * targeted send.
         */
        data class Success(val handle: String) : Result()

        data class Failure(val reason: SentoriPush.Failure, val message: String) : Result()
    }

    private val lock = Any()
    private var cachedHandle: String? = null
    private var onMessage: ((Map<String, Any?>) -> Unit)? = null
    private var onTap: ((Map<String, Any?>) -> Unit)? = null
    private var drainTask: ScheduledFuture<*>? = null

    private const val PREFS = "com.sentori.push"
    private const val HANDLE_KEY = "handle"

    private val worker =
        Executors.newSingleThreadScheduledExecutor { r ->
            Thread(r, "sentori-push").apply { isDaemon = true }
        }

    /**
     * Ask for permission, get a token, register it.
     *
     * Safe to call on every launch: Android returns its cached
     * decision without re-prompting, and the server upserts on
     * `(project, provider, token)`.
     *
     * Call [Sentori.user] first if the device should be reachable from
     * an issue. Without it the registration carries no user key and
     * the device receives broadcasts only — the dashboard shows that
     * as "N devices, 0 addressable", which is the one symptom with no
     * other explanation.
     *
     * [activity] is needed only for the Android 13+ runtime prompt;
     * pass null to skip prompting and use whatever was already
     * granted.
     */
    @JvmStatic
    @JvmOverloads
    fun register(
        context: Context,
        activity: Activity? = null,
        timeoutMs: Long = 8_000,
        onMessage: ((Map<String, Any?>) -> Unit)? = null,
        onTap: ((Map<String, Any?>) -> Unit)? = null,
        completion: (Result) -> Unit,
    ) {
        val config = SentoriConfig.current
        if (config == null) {
            deliver(completion, Result.Failure(Failure.NOT_INITIALISED, "Sentori.start has not run"))
            return
        }

        // Bind before asking for anything: a tap that arrived while
        // the app was dead is replayed as soon as the service starts,
        // and a callback set afterwards misses it.
        synchronized(lock) {
            this.onMessage = onMessage
            this.onTap = onTap
        }

        val appContext = context.applicationContext
        val proceed = { status: String ->
            worker.execute {
                deliver(completion, finishRegister(appContext, config, status, timeoutMs))
            }
        }

        val current = SentoriPushNotifications.currentPermission(appContext)
        if (current == "notDetermined" && activity != null) {
            // `timeoutMs` is a network budget — how long to wait for a
            // device token. Spending it on a person reading a dialog
            // is a category error: the default is eight seconds, and
            // nobody answers a permission prompt in eight seconds.
            SentoriPushNotifications.requestPermission(
                activity,
                timeoutMs = permissionTimeoutMs,
            ) { proceed(it) }
        } else {
            proceed(current)
        }
    }

    /**
     * How long to wait for someone to answer the permission dialog.
     *
     * Separate from `timeoutMs`, which is about the network. A person
     * may be reading, or may have put the phone down; two minutes
     * covers the first and gives up on the second rather than leaving
     * a registration that never reports anything.
     */
    @JvmStatic
    var permissionTimeoutMs: Long = 120_000

    /**
     * Say it out loud, once, where the person wiring this up is
     * looking.
     *
     * A failed `register` reported only to the server is invisible on
     * the machine where the mistake was made: the integrator has to
     * finish connecting the dashboard before it can tell them they
     * have not finished connecting the dashboard. insight found their
     * first-launch failure by adding a `Log.w` of their own and
     * taking it out again.
     *
     * Warning, never error. A red line in someone else's logcat reads
     * as "your app is broken", and a host team that believes that
     * pulls the SDK out.
     */
    private fun deliver(completion: (Result) -> Unit, result: Result) {
        if (result is Result.Failure) {
            android.util.Log.w(
                "sentori",
                "push register failed (${result.reason.reason}): ${result.message}",
            )
        }
        completion(result)
    }

    private fun finishRegister(
        context: Context,
        config: SentoriConfig,
        status: String,
        timeoutMs: Long,
    ): Result {
        if (status != "granted") {
            return Result.Failure(Failure.PERMISSION_DENIED, "push permission '$status'")
        }

        SentoriPushNotifications.registerForRemoteNotifications(context)

        val token = waitForToken(timeoutMs)
        if (token == null) {
            // An FCM that is not on the classpath reports an error
            // rather than a token, and that is a build fact rather
            // than something the user chose.
            val err = SentoriPushNotifications.drainState()["error"] as? String
            return if (err != null) {
                Result.Failure(Failure.NO_TRANSPORT, err)
            } else {
                Result.Failure(Failure.TOKEN_TIMEOUT, "no device token within ${timeoutMs}ms")
            }
        }

        return when (val r = registerWithServer(token, config)) {
            is Result.Success -> {
                synchronized(lock) { cachedHandle = r.handle }
                context
                    .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(HANDLE_KEY, r.handle)
                    .apply()
                startDrain()
                r
            }
            else -> r
        }
    }

    /** The handle from an earlier [register], without a round trip. */
    @JvmStatic
    fun cachedDeviceHandle(context: Context): String? =
        synchronized(lock) { cachedHandle }
            ?: context
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(HANDLE_KEY, null)

    /** Current permission without prompting. */
    @JvmStatic
    fun permissionStatus(context: Context): String =
        SentoriPushNotifications.currentPermission(context.applicationContext)

    /**
     * Revoke the handle server-side and stop local delivery.
     * Idempotent — repeat calls do nothing.
     */
    @JvmStatic
    @JvmOverloads
    fun unregister(context: Context, completion: ((Boolean) -> Unit)? = null) {
        val appContext = context.applicationContext
        val handle = cachedDeviceHandle(appContext)
        synchronized(lock) {
            cachedHandle = null
            onMessage = null
            onTap = null
            drainTask?.cancel(false)
            drainTask = null
        }
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(HANDLE_KEY).apply()
        SentoriPushNotifications.unregisterForRemoteNotifications(appContext)

        val config = SentoriConfig.current
        if (handle == null || config == null) {
            completion?.invoke(false)
            return
        }
        worker.execute {
            var conn: HttpURLConnection? = null
            val ok =
                try {
                    conn =
                        URL("${config.ingestUrl}/v1/push/tokens/$handle").openConnection()
                            as HttpURLConnection
                    conn.requestMethod = "DELETE"
                    conn.setRequestProperty("Authorization", "Bearer ${config.token}")
                    conn.connectTimeout = 15_000
                    conn.readTimeout = 15_000
                    conn.responseCode in 200..299
                } catch (_: Throwable) {
                    false
                } finally {
                    conn?.disconnect()
                }
            completion?.invoke(ok)
        }
    }

    // ── internals ─────────────────────────────────────────────────

    private fun waitForToken(timeoutMs: Long): String? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val state = SentoriPushNotifications.drainState()
            flush(state)
            (state["token"] as? String)?.let { return it }
            if (state["error"] != null) return null
            try {
                Thread.sleep(200)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return null
            }
        }
        return null
    }

    private fun registerWithServer(token: String, config: SentoriConfig): Result {
        val body =
            mutableMapOf<String, Any?>(
                // `kind`, not `provider`. The React Native SDK sent
                // `provider` for a year and earned a 422 for every
                // registration it ever attempted.
                "kind" to "fcm",
                "nativeToken" to token,
                // No `env`: FCM is one host, with no sandbox and
                // production split for a token to be wrong about.
            )
        // The same identity hash every event carries, so the dashboard
        // can address this device by the person who hit an issue.
        // Absent until the host calls `Sentori.user`.
        SentoriScope.userKey?.let { body["userKey"] = it }

        var conn: HttpURLConnection? = null
        return try {
            conn =
                URL("${config.ingestUrl}/v1/push/tokens").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Authorization", "Bearer ${config.token}")
            conn.setRequestProperty("Sentori-Sdk", "kotlin/${SentoriVersion.CURRENT}")
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.outputStream.use {
                it.write(SentoriTransport.toJson(body).toString().toByteArray(Charsets.UTF_8))
            }

            val code = conn.responseCode
            if (code !in 200..299) {
                Result.Failure(Failure.SERVER_REJECTED, "HTTP $code")
            } else {
                val text = conn.inputStream.bufferedReader().readText()
                // The handle is the `device_tokens` row id, a bare
                // uuid. The RN SDK parsed it as an `ipt_*` string no
                // server has ever returned.
                val handle = JSONObject(text).optString("token_id")
                if (handle.isNullOrEmpty()) {
                    Result.Failure(Failure.SERVER_REJECTED, "server returned no device token id")
                } else {
                    Result.Success(handle)
                }
            }
        } catch (e: Throwable) {
            Result.Failure(Failure.SERVER_REJECTED, e.message ?: e.javaClass.name)
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * 1 Hz while registered. The FCM service buffers arrivals and
     * taps; this hands them to the host.
     */
    private fun startDrain() {
        synchronized(lock) {
            if (drainTask != null) return
            drainTask =
                worker.scheduleWithFixedDelay(
                    { flush(SentoriPushNotifications.drainState()) },
                    1,
                    1,
                    TimeUnit.SECONDS,
                )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun flush(state: Map<String, Any?>) {
        val (message, tap) = synchronized(lock) { onMessage to onTap }
        if (message == null && tap == null) return
        (state["notifications"] as? List<Map<String, Any?>>)?.forEach { message?.invoke(it) }
        (state["taps"] as? List<Map<String, Any?>>)?.forEach { tap?.invoke(it) }
    }

    internal fun resetForTests() {
        synchronized(lock) {
            cachedHandle = null
            onMessage = null
            onTap = null
            drainTask?.cancel(false)
            drainTask = null
        }
    }
}
