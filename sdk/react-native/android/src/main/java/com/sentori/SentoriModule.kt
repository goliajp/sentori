package com.sentori

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Module exposing the Android crash handler to JS. Same JS contract
 * as the iOS module:
 *   - setConfig({ token, release, environment })
 *   - drainPending() -> List<String>  (JSON bodies)
 *   - startAnrWatchdog({ timeoutMs?, intervalMs?, force? })
 *   - stopAnrWatchdog()
 */
class SentoriModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("Sentori")

        OnCreate {
            val ctx = appContext.reactContext ?: return@OnCreate
            SentoriCrashHandler.register(ctx)
        }

        Function("setConfig") { config: Map<String, Any?> ->
            SentoriCrashHandler.setConfig(config)
        }

        AsyncFunction("drainPending") {
            SentoriCrashHandler.consumePending()
        }

        // Watchdog is opt-in from JS so the host app picks the
        // trade-off — stricter detection vs noise from the Metro
        // debugger pausing the main thread. Pass `force: true` to
        // run in debug builds.
        Function("startAnrWatchdog") { options: Map<String, Any?>? ->
            val ctx = appContext.reactContext ?: return@Function
            val timeoutMs = (options?.get("timeoutMs") as? Number)?.toLong() ?: 5_000L
            val intervalMs = (options?.get("intervalMs") as? Number)?.toLong() ?: 1_000L
            val force = (options?.get("force") as? Boolean) ?: false
            SentoriAnrWatchdog.start(ctx, timeoutMs, intervalMs, force)
        }

        Function("stopAnrWatchdog") {
            SentoriAnrWatchdog.stop()
        }

        // Dev-only helper — schedules an uncaught RuntimeException after
        // a tick so the JS bridge has time to return; the crash is then
        // captured by SentoriCrashHandler and written to
        // <filesDir>/sentori/pending/.
        Function("triggerTestNativeCrash") {
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                throw RuntimeException("Sentori test native crash")
            }, 50)
        }
    }
}
