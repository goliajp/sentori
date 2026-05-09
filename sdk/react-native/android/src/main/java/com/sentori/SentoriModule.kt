package com.sentori

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Module exposing the Android crash handler to JS. Same JS contract
 * as the iOS module:
 *   - setConfig({ token, release, environment })
 *   - drainPending() -> List<String>  (JSON bodies)
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
