// GENERATED MIRROR — do not edit.
// Source of truth: sdk/native/android/src/main/java/com/sentori/SentoriScope.kt
// Run `node scripts/sync-native-core.mjs` after editing it.
package com.sentori

/**
 * Ambient scope: the current user and the context patch that ride
 * every outgoing event. Two verbs own this state; everything else
 * reads it.
 */
object SentoriScope {

    private val lock = Any()
    private var _userKey: String? = null
    private val _context = mutableMapOf<String, Any?>()

    /**
     * Identify the person using the app. Only the hash goes on the
     * wire; the id and email stay on the device.
     *
     * Unlike the JavaScript version this is genuinely synchronous —
     * WebCrypto's digest is a promise, so `scope.ts` sets the key a
     * tick later and events sent in that gap carry none.
     * `MessageDigest` has no such gap, so the first event after this
     * call is already addressable.
     *
     * Pass null for both to forget the user on sign-out.
     */
    @JvmStatic
    fun setUser(id: String?, email: String?) {
        val key = SentoriIdentity.userKey(id, email)
        synchronized(lock) { _userKey = key }
    }

    /** Merge keys into the ambient context. Later calls win per key. */
    @JvmStatic
    fun patchContext(patch: Map<String, Any?>) {
        synchronized(lock) { _context.putAll(patch) }
    }

    @JvmStatic
    val userKey: String?
        get() = synchronized(lock) { _userKey }

    /**
     * Null rather than an empty map, so an event with no context omits
     * the field instead of carrying `{}`.
     */
    @JvmStatic
    val context: Map<String, Any?>?
        get() = synchronized(lock) { if (_context.isEmpty()) null else _context.toMap() }

    @JvmStatic
    fun clear() {
        synchronized(lock) {
            _userKey = null
            _context.clear()
        }
    }
}
