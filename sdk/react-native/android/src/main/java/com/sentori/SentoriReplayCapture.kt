package com.sentori

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

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
    private const val MAX_DEPTH = 60

    // Diagnostic readouts. Mirrors the iOS side. Surfaced via
    // `probe()` so JS can answer "why is the ring shallow?" without
    // parsing logcat.
    //
    // v0.9.12: lastPath + lastNodes
    // v1.0.0-rc.3:
    //   * lastDepthMax — deepest descendant the walker reached. If
    //     this stays at 2 or 3 we know the recursion bailed early
    //     (the rc.2 zero-size-bails-subtree bug).
    //   * lastSizeBytes — byte length of the serialised payload. ~50
    //     bytes per node is typical; a 1 KB result with 800 nodes
    //     would be a red flag.
    //   * totalTicks / lastEmptyResultTicks — lifetime counters for
    //     ring health, so a thin-but-non-null capture doesn't slip
    //     through unnoticed.
    @Volatile private var lastDiagPath: String = "none(not-yet-called)"
    @Volatile private var lastDiagNodes: Int = 0
    @Volatile private var lastDiagDepthMax: Int = 0
    @Volatile private var lastDiagSizeBytes: Int = 0
    @Volatile private var totalTicks: Long = 0
    @Volatile private var totalEmptyResultTicks: Long = 0

    @JvmStatic
    fun probe(): Map<String, Any> {
        val activity = SentoriForegroundActivity.current()
        return mapOf(
            "lastPath" to lastDiagPath,
            "lastNodes" to lastDiagNodes,
            "lastDepthMax" to lastDiagDepthMax,
            "lastSizeBytes" to lastDiagSizeBytes,
            "totalTicks" to totalTicks,
            "totalEmptyResultTicks" to totalEmptyResultTicks,
            "trackedSource" to SentoriForegroundActivity.lastPath,
            "trackedActivity" to (activity?.javaClass?.name ?: "null"),
            "decorViewFound" to (activity?.window?.decorView != null),
        )
    }

    /** Backwards compat — pre-rc.2 callers that hand-fed an Activity
     *  through `setActivity` still work; we forward to the shared
     *  tracker so screenshot + replay both see it. */
    @JvmStatic
    fun setActivity(activity: Activity?) {
        if (activity != null) SentoriForegroundActivity.set(activity, "manual.setActivity")
    }

    /** Idempotent. Wires the replay helper into the shared tracker;
     *  kept as a public entrypoint for backwards compat with existing
     *  call sites. */
    @JvmStatic
    fun register(application: android.app.Application) {
        SentoriForegroundActivity.install(application)
    }

    @JvmStatic
    fun captureWireframe(maskedIds: List<String>): String? {
        totalTicks++
        val activity = SentoriForegroundActivity.current()
        if (activity == null) {
            lastDiagPath = "activity.null"
            totalEmptyResultTicks++
            return null
        }
        val root = activity.window?.decorView
        if (root == null) {
            lastDiagPath = "decorView.null"
            totalEmptyResultTicks++
            return null
        }
        if (root.width <= 0 || root.height <= 0) {
            lastDiagPath = "root.zero-size"
            totalEmptyResultTicks++
            return null
        }

        val maskedSet = maskedIds.toHashSet()
        val nodes = JSONArray()
        val rootLoc = IntArray(2).also { root.getLocationInWindow(it) }
        val ctx = WalkContext(rootLoc = rootLoc, maskedSet = maskedSet)
        walk(root, depth = 0, parentMasked = false, ctx = ctx, nodes = nodes)

        val payload = JSONObject().apply {
            put("ts", System.currentTimeMillis())
            put("width", root.width)
            put("height", root.height)
            put("nodes", nodes)
        }
        val serialised = payload.toString()

        lastDiagPath = "ok(${SentoriForegroundActivity.lastPath})"
        lastDiagNodes = nodes.length()
        lastDiagDepthMax = ctx.depthMax
        lastDiagSizeBytes = serialised.length

        if (nodes.length() == 0) totalEmptyResultTicks++

        return serialised
    }

    /** Per-walk scratch: tracks the deepest descendant reached so
     *  the probe can surface whether the recursion ran or bailed.
     *  Bundled into one object to keep the recursive signature
     *  manageable. */
    private class WalkContext(
        val rootLoc: IntArray,
        val maskedSet: Set<String>,
        var depthMax: Int = 0,
    )

    /**
     * Recursive walker.
     *
     * v1.0.0-rc.3 fix: previously this function returned ENTIRELY
     * when the view itself had `width <= 0 || height <= 0`. That
     * meant any ViewGroup wrapper that happened to measure to zero
     * size during the tick (common on Fabric / RN's intermediate
     * shadow-tree wrappers, and on lazy-layout phases) skipped the
     * whole descendant subtree — Insight 2026-05-17 verify event
     * saw 800-node frames whose subtree was actually thousands of
     * Views deep but only the root + 2-3 wrappers made it into the
     * JSON.
     *
     * Now we separate "emit a node for this view" from "recurse into
     * its children". A zero-size view doesn't get an emitted node
     * (no visual contribution) but its descendants still get walked
     * — they may have real frames.
     */
    private fun walk(
        view: View,
        depth: Int,
        parentMasked: Boolean,
        ctx: WalkContext,
        nodes: JSONArray,
    ) {
        if (nodes.length() >= MAX_NODES) return
        if (depth >= MAX_DEPTH) return
        if (view.visibility != View.VISIBLE || view.alpha < 0.01) return

        if (depth > ctx.depthMax) ctx.depthMax = depth

        val viewTag = view.tag as? String
        val isThisMasked = viewTag != null && ctx.maskedSet.contains(viewTag)
        val masked = parentMasked || isThisMasked

        val w = view.width
        val h = view.height

        // Emit a node ONLY when the view has visual extent. A zero-
        // size view contributes nothing to render but its subtree
        // might; recurse below regardless.
        if (w > 0 && h > 0) {
            val loc = IntArray(2)
            view.getLocationInWindow(loc)
            val x = loc[0] - ctx.rootLoc[0]
            val y = loc[1] - ctx.rootLoc[1]

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
        }

        // Always recurse — even zero-size wrappers can host real
        // descendants (the rc.3 fix).
        if (!masked && view is ViewGroup) {
            for (i in 0 until view.childCount) {
                walk(view.getChildAt(i), depth + 1, masked, ctx, nodes)
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
