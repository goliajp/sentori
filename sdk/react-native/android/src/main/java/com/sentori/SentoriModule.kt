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
    }
}
