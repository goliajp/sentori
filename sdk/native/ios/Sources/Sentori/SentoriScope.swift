import Foundation

/// Ambient scope: the current user and the context patch that ride
/// every outgoing event. Two verbs own this state; everything else
/// reads it.
@objc(SentoriScope)
public final class SentoriScope: NSObject {

    private static let lock = NSLock()
    private static var _userKey: String?
    private static var _context: [String: Any] = [:]

    /// Identify the person using the app. Only the hash goes on the
    /// wire; the id and email stay on the device.
    ///
    /// Unlike the JavaScript version this is genuinely synchronous —
    /// WebCrypto's digest is a promise, so `scope.ts` sets the key a
    /// tick later and events sent in that gap carry none. CryptoKit
    /// has no such gap, so the first event after this call is already
    /// addressable.
    ///
    /// Pass `nil` for both to forget the user on sign-out.
    @objc public static func setUser(id: String?, email: String?) {
        let key = SentoriIdentity.userKey(id: id, email: email)
        lock.lock()
        _userKey = key
        lock.unlock()
    }

    /// Merge keys into the ambient context. Later calls win per key;
    /// nothing is ever removed except by `clear`.
    @objc public static func patchContext(_ patch: [String: Any]) {
        lock.lock()
        for (k, v) in patch { _context[k] = v }
        lock.unlock()
    }

    @objc public static var userKey: String? {
        lock.lock()
        defer { lock.unlock() }
        return _userKey
    }

    /// `nil` rather than an empty dictionary, so an event with no
    /// context omits the field instead of carrying `{}`.
    @objc public static var context: [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        return _context.isEmpty ? nil : _context
    }

    @objc public static func clear() {
        lock.lock()
        _userKey = nil
        _context = [:]
        lock.unlock()
    }
}
