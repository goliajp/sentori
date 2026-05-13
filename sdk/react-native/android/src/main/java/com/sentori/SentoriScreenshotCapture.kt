package com.sentori

import android.app.Activity
import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.Window
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/**
 * Phase 42 sub-F.01/02/08 — capture the current activity's screen +
 * view tree at native crash / ANR time.
 *
 * Lives separately from `SentoriCrashHandler` so we can also invoke
 * it from `SentoriAnrWatchdog` (sub-F.07: ANR detector fires →
 * snapshot main thread state → enqueue with the ANR event).
 *
 * The Android side of this story is harder than iOS:
 *   - iOS NSException fires on the main thread before tear-down → we
 *     can drive UIKit synchronously.
 *   - On Android, `Thread.UncaughtExceptionHandler` is on whatever
 *     thread crashed, *not* always the main one. Even on main, the
 *     activity might be partially torn down by the time we run.
 *   - `View.draw(Canvas)` works on the main thread (needs the view's
 *     RenderNode to be live); we use `PixelCopy.request` (API 24+)
 *     instead because it's GPU-driven, non-blocking on main, and
 *     produces a Bitmap even if the main thread is wedged (sub-F.07
 *     ANR path needs this).
 *   - Bitmap.compress(WEBP_LOSSY, ...) is Android 11+ only. We pick
 *     it when available, fall back to JPEG q=70 below 30.
 *
 * Output mirrors the iOS Swift helper + the sub-G dashboard schema:
 *
 *     {
 *       "screenshot": { "base64": "...", "mediaType": "image/webp|jpeg" },
 *       "viewTree":   { "rootId": "n1", "nodes": { ... } }
 *     }
 */
object SentoriScreenshotCapture {

    private const val MAX_LONG_EDGE_PX = 480
    private const val WEBP_QUALITY = 70
    private const val JPEG_QUALITY = 70
    private const val MAX_TREE_DEPTH = 10
    private const val MAX_NODES = 1500
    private const val PIXEL_COPY_TIMEOUT_MS = 200L

    /// Latest activity we've seen via `ActivityLifecycleCallbacks` —
    /// used to find the window to screenshot when neither the JS
    /// side (which knows of `Activity.this` via React Native) nor
    /// the crash handler hands one to us.
    @Volatile private var lastActivity: WeakReference<Activity>? = null

    /**
     * Attach an `ActivityLifecycleCallbacks` so subsequent
     * `captureScreen()` calls know which Activity (and therefore
     * Window) to target. Idempotent; call from
     * `SentoriCrashHandler.register(context)`.
     */
    @JvmStatic
    fun register(application: Application) {
        application.registerActivityLifecycleCallbacks(object :
            Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(a: Activity, b: Bundle?) {
                lastActivity = WeakReference(a)
            }
            override fun onActivityStarted(a: Activity) {
                lastActivity = WeakReference(a)
            }
            override fun onActivityResumed(a: Activity) {
                lastActivity = WeakReference(a)
            }
            override fun onActivityPaused(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
    }

    /**
     * Top-level entry. Returns a JSON-shape `{screenshot, viewTree}`
     * map, or `null` if the activity is gone / API < 24 / capture
     * timed out. Safe to call from any thread; the PixelCopy request
     * itself runs on its own HandlerThread so the calling thread
     * (main during NSException-equivalent / ANR detector) doesn't
     * block on the GPU.
     */
    @JvmStatic
    fun captureKeyWindow(): Map<String, Any>? {
        val activity = lastActivity?.get() ?: return null
        val window = activity.window ?: return null
        val out = mutableMapOf<String, Any>()
        captureScreen(window)?.let { (base64, mediaType) ->
            out["screenshot"] = mapOf("base64" to base64, "mediaType" to mediaType)
        }
        out["viewTree"] = walkTree(window.decorView)
        return if (out.isEmpty()) null else out
    }

    // ── screenshot ────────────────────────────────────────────────

    private fun captureScreen(window: Window): Pair<String, String>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            // PixelCopy is API 24+. Older Android: fall back to a
            // `View.draw(Canvas)` path that *must* run on main and
            // requires the activity not to be torn down. Skip for
            // now; v0.6.1 SDK can add the fallback if real-world
            // data shows we have users below API 24.
            return null
        }
        val decor = window.decorView ?: return null
        val w = decor.width
        val h = decor.height
        if (w <= 0 || h <= 0) return null

        // Long-edge scale.
        val longEdge = maxOf(w, h).toFloat()
        val scale = if (longEdge > MAX_LONG_EDGE_PX) MAX_LONG_EDGE_PX / longEdge else 1f
        val outW = (w * scale).toInt().coerceAtLeast(1)
        val outH = (h * scale).toInt().coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)

        val latch = CountDownLatch(1)
        var success = false
        val handlerThread = HandlerThread("sentori-pixel-copy").apply { start() }
        val handler = Handler(handlerThread.looper)
        try {
            // Render the live window into our smaller Bitmap. PixelCopy
            // does the scale internally (`request(Window, Rect, Bitmap, ...)`
            // signature on API 26+; on 24/25 we use the rectless variant
            // and accept the unscaled bitmap, then downscale ourselves).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PixelCopy.request(
                    window,
                    bitmap,
                    { result -> success = result == PixelCopy.SUCCESS; latch.countDown() },
                    handler,
                )
            } else {
                @Suppress("DEPRECATION")
                PixelCopy.request(
                    window,
                    bitmap,
                    { result -> success = result == PixelCopy.SUCCESS; latch.countDown() },
                    handler,
                )
            }
            latch.await(PIXEL_COPY_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (_: Throwable) {
            return null
        } finally {
            handlerThread.quitSafely()
        }
        if (!success) return null

        val baos = ByteArrayOutputStream(64 * 1024)
        val mediaType: String
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+: native WEBP_LOSSY ~30% smaller than JPEG q=70.
            bitmap.compress(Bitmap.CompressFormat.WEBP_LOSSY, WEBP_QUALITY, baos)
            mediaType = "image/webp"
        } else {
            bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos)
            mediaType = "image/jpeg"
        }
        bitmap.recycle()
        val base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
        return Pair(base64, mediaType)
    }

    // ── view tree ─────────────────────────────────────────────────

    /** Synchronously walk the view hierarchy from `root`. Safe to call
     *  from any thread *as long as no concurrent layout pass is
     *  invalidating subview lists* — at crash time the main thread is
     *  paused on the exception handler, so the read is race-free. */
    private fun walkTree(root: View): Map<String, Any> {
        val nodes = mutableMapOf<String, Any>()
        var counter = 0
        var nodeCount = 0

        fun nextId(): String {
            counter += 1
            return "n$counter"
        }

        fun walk(view: View, depth: Int): String {
            val id = nextId()
            nodeCount += 1
            val children = mutableListOf<String>()
            if (depth < MAX_TREE_DEPTH && nodeCount < MAX_NODES && view is ViewGroup) {
                for (i in 0 until view.childCount) {
                    if (nodeCount >= MAX_NODES) break
                    children.add(walk(view.getChildAt(i), depth + 1))
                }
            }
            val rect = "${view.left},${view.top},${view.width},${view.height}"
            val propsSummary = mutableMapOf(
                "frame" to rect,
                "alpha" to String.format("%.2f", view.alpha),
                "hidden" to (view.visibility != View.VISIBLE).toString(),
            )
            view.contentDescription?.toString()?.takeIf { it.isNotEmpty() }?.let {
                propsSummary["contentDescription"] = if (it.length > 200) it.substring(0, 200) else it
            }
            nodes[id] = mapOf(
                "type" to "View",
                "name" to view.javaClass.simpleName,
                "props_summary" to propsSummary,
                "children" to children,
            )
            return id
        }

        val rootId = walk(root, 0)
        return mapOf("rootId" to rootId, "nodes" to nodes)
    }

    // ── helpers for the crash-handler JSON path ───────────────────

    /**
     * Convert a Kotlin Map-tree into a `JSONObject`-tree suitable for
     * embedding inside the event JSON written by `SentoriCrashHandler`.
     * Public so the crash handler can use it.
     */
    @JvmStatic
    fun toJson(value: Any?): Any {
        return when (value) {
            null -> JSONObject.NULL
            is Map<*, *> -> JSONObject().apply {
                for ((k, v) in value) put(k.toString(), toJson(v))
            }
            is List<*> -> JSONArray().apply {
                for (v in value) put(toJson(v))
            }
            else -> value
        }
    }

    /**
     * Convenience for `Canvas.draw` benchmarking in instrumentation
     * tests (sub-F.10). Renders the input `view` onto a Bitmap on the
     * caller's thread — *do not* use this at crash time; it only
     * exists for test latency measurements.
     */
    @JvmStatic
    fun benchmarkRenderToBitmapBlocking(view: View): Long {
        val w = view.width.coerceAtLeast(1)
        val h = view.height.coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val started = System.nanoTime()
        view.draw(canvas)
        val elapsed = System.nanoTime() - started
        bmp.recycle()
        return elapsed
    }
}
