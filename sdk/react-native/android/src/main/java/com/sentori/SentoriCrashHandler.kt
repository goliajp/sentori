package com.sentori

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Static crash handler — captures Java/Kotlin uncaught exceptions on
 * Android and writes one event-shaped JSON file per crash to
 * <filesDir>/sentori/pending/<uuid>.json. JS drains that directory on
 * next launch via Sentori.drainPending().
 *
 * What this does NOT do (Phase 7 v0.1):
 *   - native crashes (NDK / SIGSEGV) — Phase 7 explicitly skips signal-
 *     based handlers per ROADMAP.
 *   - ANR detection — deferred to v0.2.
 */
object SentoriCrashHandler {

    private const val PREFS = "sentori"
    private const val PENDING_DIR_NAME = "sentori/pending"

    @Volatile private var appCtx: Context? = null
    @Volatile private var previousHandler: Thread.UncaughtExceptionHandler? = null

    @JvmStatic
    fun register(context: Context) {
        appCtx = context.applicationContext
        previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                write(throwable)
            } catch (_: Throwable) {
                // never throw inside the crash handler
            }
            previousHandler?.uncaughtException(thread, throwable)
        }
    }

    @JvmStatic
    fun setConfig(config: Map<String, Any?>) {
        val ctx = appCtx ?: return
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val edit = prefs.edit()
        edit.clear()
        for ((k, v) in config) {
            when (v) {
                is String -> edit.putString(k, v)
                is Int -> edit.putInt(k, v)
                is Boolean -> edit.putBoolean(k, v)
                else -> {}
            }
        }
        edit.apply()
    }

    @JvmStatic
    fun consumePending(): List<String> {
        val dir = pendingDir() ?: return emptyList()
        if (!dir.exists()) return emptyList()
        val out = mutableListOf<String>()
        val files = dir.listFiles { f -> f.extension == "json" } ?: emptyArray()
        for (f in files) {
            try {
                out.add(f.readText())
            } catch (_: Throwable) {
                // skip unreadable file
            }
            f.delete()
        }
        return out
    }

    // ── internals ────────────────────────────────────────────────

    private fun pendingDir(): File? {
        val ctx = appCtx ?: return null
        val dir = File(ctx.filesDir, PENDING_DIR_NAME)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun configMap(): Map<String, String> {
        val ctx = appCtx ?: return emptyMap()
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val out = mutableMapOf<String, String>()
        for ((k, v) in prefs.all) if (v is String) out[k] = v
        return out
    }

    private fun write(throwable: Throwable) {
        val cfg = configMap()
        val release = cfg["release"] ?: "unknown"
        val environment = cfg["environment"] ?: "prod"

        val device = JSONObject().apply {
            put("os", "android")
            put("osVersion", Build.VERSION.RELEASE)
            put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
        }

        val app = JSONObject().apply {
            put("version", appVersion())
            put("build", appBuild())
        }

        val error = errorToJson(throwable)

        val event = JSONObject().apply {
            put("id", uuidLower())
            put("timestamp", iso8601Now())
            put("kind", "error")
            put("platform", "android")
            put("release", release)
            put("environment", environment)
            put("device", device)
            put("app", app)
            put("user", JSONObject.NULL)
            put("tags", JSONObject())
            put("breadcrumbs", JSONArray())
            put("error", error)
            put("fingerprint", JSONArray())
            put("traceId", JSONObject.NULL)
            put("spanId", JSONObject.NULL)
        }

        val dir = pendingDir() ?: return
        val file = File(dir, "${uuidLower()}.json")
        try {
            file.writeText(event.toString())
        } catch (_: Throwable) {
            // best-effort
        }
    }

    private fun errorToJson(throwable: Throwable): JSONObject {
        return JSONObject().apply {
            put("type", throwable.javaClass.name)
            put("message", throwable.message ?: "")
            put("stack", framesToJson(throwable))
            val cause = throwable.cause
            if (cause != null && cause !== throwable) {
                put("cause", errorToJson(cause))
            } else {
                put("cause", JSONObject.NULL)
            }
        }
    }

    private fun framesToJson(throwable: Throwable): JSONArray {
        val arr = JSONArray()
        for (f in throwable.stackTrace) {
            val frame = JSONObject().apply {
                put("function", "${f.className}.${f.methodName}")
                put("file", f.fileName ?: "<unknown>")
                put("line", f.lineNumber.coerceAtLeast(0))
                put("inApp", isInApp(f))
            }
            arr.put(frame)
        }
        return arr
    }

    private fun isInApp(f: StackTraceElement): Boolean {
        val cls = f.className
        if (cls.startsWith("android.")) return false
        if (cls.startsWith("androidx.")) return false
        if (cls.startsWith("java.")) return false
        if (cls.startsWith("javax.")) return false
        if (cls.startsWith("kotlin.")) return false
        if (cls.startsWith("kotlinx.")) return false
        if (cls.startsWith("com.facebook.react.")) return false
        if (cls.startsWith("com.android.")) return false
        if (cls.startsWith("dalvik.")) return false
        if (cls.startsWith("sun.")) return false
        return true
    }

    private fun iso8601Now(): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date())
    }

    private fun uuidLower(): String = UUID.randomUUID().toString().lowercase(Locale.US)

    private fun appVersion(): String {
        val ctx = appCtx ?: return "0.0.0"
        return try {
            val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            pi.versionName ?: "0.0.0"
        } catch (_: Throwable) {
            "0.0.0"
        }
    }

    private fun appBuild(): String {
        val ctx = appCtx ?: return "0"
        return try {
            val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
            pi.longVersionCode.toString()
        } catch (_: Throwable) {
            "0"
        }
    }
}
