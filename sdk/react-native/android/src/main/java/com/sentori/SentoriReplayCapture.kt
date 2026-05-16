package com.sentori

import android.app.Activity
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * v0.9.6 #2 — wireframe session replay (Android side).
 *
 * Mirrors SentoriReplayCapture.swift. Walks View hierarchy from the
 * current activity's decor view at 1 Hz. Each visible node becomes
 * a JSON dict { kind, x, y, w, h, text?, color? }. Returns one JSON
 * object string per snapshot.
 *
 * Mask: nodes whose `View.tag` (cast to String) matches `maskedIds`
 * render as a single black "mask" rect. Descendants of a masked
 * node are not emitted.
 */
object SentoriReplayCapture {

    private const val MAX_NODES = 800

    @Volatile private var lastActivity: WeakReference<Activity>? = null

    @JvmStatic
    fun setActivity(activity: Activity?) {
        lastActivity = activity?.let { WeakReference(it) }
    }

    /** Attach an ActivityLifecycleCallbacks so future
     *  `captureWireframe()` calls know which Activity to walk. */
    @JvmStatic
    fun register(application: android.app.Application) {
        application.registerActivityLifecycleCallbacks(object :
            android.app.Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(a: Activity, b: android.os.Bundle?) { setActivity(a) }
            override fun onActivityStarted(a: Activity) { setActivity(a) }
            override fun onActivityResumed(a: Activity) { setActivity(a) }
            override fun onActivityPaused(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, b: android.os.Bundle) {}
            override fun onActivityDestroyed(a: Activity) {}
        })
    }

    @JvmStatic
    fun captureWireframe(maskedIds: List<String>): String? {
        val activity = lastActivity?.get() ?: return null
        val root = activity.window?.decorView ?: return null
        if (root.width <= 0 || root.height <= 0) return null

        val maskedSet = maskedIds.toHashSet()
        val nodes = JSONArray()
        val rect = Rect()
        val rootLoc = IntArray(2).also { root.getLocationInWindow(it) }
        walk(root, false, maskedSet, rootLoc, rect, nodes)

        val payload = JSONObject().apply {
            put("ts", System.currentTimeMillis())
            put("width", root.width)
            put("height", root.height)
            put("nodes", nodes)
        }
        return payload.toString()
    }

    private fun walk(
        view: View,
        parentMasked: Boolean,
        maskedSet: Set<String>,
        rootLoc: IntArray,
        scratch: Rect,
        nodes: JSONArray,
    ) {
        if (nodes.length() >= MAX_NODES) return
        if (view.visibility != View.VISIBLE || view.alpha < 0.01) return

        val viewTag = view.tag as? String
        val isThisMasked = viewTag != null && maskedSet.contains(viewTag)
        val masked = parentMasked || isThisMasked

        val loc = IntArray(2)
        view.getLocationInWindow(loc)
        val x = loc[0] - rootLoc[0]
        val y = loc[1] - rootLoc[1]
        val w = view.width
        val h = view.height
        if (w <= 0 || h <= 0) return

        val node = JSONObject().apply {
            put("x", x)
            put("y", y)
            put("w", w)
            put("h", h)
        }

        var kindEmitted = false
        when {
            masked -> {
                node.put("kind", "mask")
                kindEmitted = true
            }
            view is TextView && !view.text.isNullOrEmpty() -> {
                node.put("kind", "text")
                val text = view.text.toString().let { if (it.length > 200) it.substring(0, 200) else it }
                node.put("text", text)
                node.put("color", colorToHex(view.currentTextColor))
                kindEmitted = true
            }
            view is EditText -> {
                node.put("kind", "text")
                val text = (view.text ?: "").toString().let { if (it.length > 200) it.substring(0, 200) else it }
                node.put("text", text)
                kindEmitted = true
            }
            view is ImageView -> {
                node.put("kind", "image")
                kindEmitted = true
            }
            view.background != null -> {
                node.put("kind", "rect")
                // Background drawables don't always expose color directly.
                // Skip color for non-ColorDrawable; renderer falls back to neutral.
                kindEmitted = true
            }
        }

        if (kindEmitted) {
            nodes.put(node)
        }

        if (!masked && view is ViewGroup) {
            for (i in 0 until view.childCount) {
                walk(view.getChildAt(i), masked, maskedSet, rootLoc, scratch, nodes)
            }
        }
    }

    private fun colorToHex(c: Int): String {
        val a = (c shr 24) and 0xff
        val r = (c shr 16) and 0xff
        val g = (c shr 8) and 0xff
        val b = c and 0xff
        return String.format("#%02X%02X%02X%02X", r, g, b, a)
    }
}
