// GENERATED MIRROR — do not edit.
// Source of truth: sdk/native/ios/Sources/Sentori/SentoriPush.swift
// Run `node scripts/sync-native-core.mjs` after editing it.
import Foundation

/// Push, as an app writes it.
///
///     let r = await Sentori.push.register()
///     if case .failure(let reason) = r { … }
///
/// The pieces underneath already existed — permission, the
/// `AppDelegate` swizzle, the token buffer, the tap and foreground
/// callbacks — and were reachable only through the React Native
/// bridge. What was missing everywhere but JavaScript is the part
/// that puts a token on the server, which is the only reason a
/// registered device is reachable at all.
///
/// Asked for by insight (2026-08-11): two apps with no React Native,
/// blocked, and unwilling to reimplement the HTTP contract because a
/// second implementation drifts silently on the one path where nobody
/// is watching.
@objc(SentoriPush)
public final class SentoriPush: NSObject {

    /// Why a registration did not produce a device handle. Each value
    /// asks the host for something different, which is the only
    /// reason to distinguish them — matching `PushRegisterFailure` in
    /// the React Native SDK exactly, so the same integration notes
    /// apply on both.
    @objc public enum Failure: Int {
        /// `Sentori.start` has not run. A wiring bug.
        case notInitialised
        /// The user said no. Not an error: do not retry on a timer,
        /// and offer it again from a settings screen.
        case permissionDenied
        /// No push entitlement in this build, or a simulator without
        /// one. Nothing to do at runtime.
        case noTransport
        /// The OS never handed back a token inside the window.
        /// Usually provisioning; retrying later is reasonable.
        case tokenTimeout
        /// Sentori answered non-2xx. Settings ▸ Push is where to look.
        case serverRejected

        public var name: String {
            switch self {
            case .notInitialised: return "not-initialised"
            case .permissionDenied: return "permission-denied"
            case .noTransport: return "no-transport"
            case .tokenTimeout: return "token-timeout"
            case .serverRejected: return "server-rejected"
            }
        }
    }

    /// Registration never throws. A denied permission is an ordinary
    /// answer, and an opt-in that throws inside someone's view model
    /// is the failure this SDK's contract with its host is written
    /// against.
    public enum Result {
        /// The `device_tokens` row id. Revoking takes it, and so does
        /// a targeted send.
        case success(handle: String)
        case failure(reason: Failure, message: String)

        public var handle: String? {
            if case .success(let h) = self { return h }
            return nil
        }
    }

    @objc public static let shared = SentoriPush()

    private let lock = NSLock()
    private var cachedHandle: String?
    private var onMessage: (([String: Any]) -> Void)?
    private var onTap: (([String: Any]) -> Void)?
    private var drainTimer: DispatchSourceTimer?

    private static let handleKey = "com.sentori.push.handle"

    /// Ask for permission, get a token, register it.
    ///
    /// Safe to call on every launch: the OS returns its cached
    /// decision without re-prompting, and the server upserts on
    /// `(project, provider, token)`.
    ///
    /// Call `Sentori.user` first if the device should be reachable
    /// from an issue. Without it the registration carries no user key
    /// and the device receives broadcasts only — the dashboard shows
    /// that as "N devices, 0 addressable", which is the one symptom
    /// with no other explanation.
    @discardableResult
    public func register(
        timeout: TimeInterval = 8,
        onMessage: (([String: Any]) -> Void)? = nil,
        onTap: (([String: Any]) -> Void)? = nil
    ) async -> Result {
        guard let config = SentoriConfig.current else {
            return .failure(reason: .notInitialised, message: "Sentori.start has not run")
        }

        // Bind before asking for anything: iOS replays a tap that
        // happened while the app was not running as soon as the
        // delegate attaches, and a callback set afterwards misses it.
        lock.lock()
        self.onMessage = onMessage
        self.onTap = onTap
        lock.unlock()

        let status = await currentOrRequestPermission()
        // "unavailable" is the native layer saying there is no app
        // bundle to ask on behalf of — a test host, a CLI, some
        // extensions. Not a decision the user made.
        guard let status, status != "unavailable" else {
            return .failure(reason: .noTransport, message: "no push support in this build")
        }
        guard ["granted", "provisional", "ephemeral"].contains(status) else {
            return .failure(reason: .permissionDenied, message: "push permission '\(status)'")
        }

        SentoriPushNotifications.shared.registerForRemoteNotifications()
        guard let token = await waitForToken(timeout: timeout) else {
            return .failure(
                reason: .tokenTimeout,
                message: "no device token within \(Int(timeout))s"
            )
        }

        switch await registerWithServer(token: token, config: config) {
        case .success(let handle):
            lock.lock()
            cachedHandle = handle
            lock.unlock()
            UserDefaults.standard.set(handle, forKey: Self.handleKey)
            startDrain()
            return .success(handle: handle)
        case .failure(let reason, let message):
            return .failure(reason: reason, message: message)
        }
    }

    /// The handle from an earlier `register`, without a round trip.
    @objc public func cachedDeviceHandle() -> String? {
        lock.lock()
        let h = cachedHandle
        lock.unlock()
        return h ?? UserDefaults.standard.string(forKey: Self.handleKey)
    }

    /// Current permission without prompting. `nil` when there is no
    /// push support in this build.
    public func permissionStatus() async -> String? {
        await withCheckedContinuation { cont in
            SentoriPushNotifications.shared.currentPermission { cont.resume(returning: $0) }
        }
    }

    /// Revoke the handle server-side and stop local delivery.
    /// Idempotent — repeat calls do nothing.
    @discardableResult
    public func unregister() async -> Bool {
        let handle = cachedDeviceHandle()
        lock.lock()
        cachedHandle = nil
        onMessage = nil
        onTap = nil
        drainTimer?.cancel()
        drainTimer = nil
        lock.unlock()
        UserDefaults.standard.removeObject(forKey: Self.handleKey)
        SentoriPushNotifications.shared.unregisterForRemoteNotifications()

        guard let handle, let config = SentoriConfig.current,
            let url = URL(string: "\(config.ingestUrl)/v1/push/tokens/\(handle)")
        else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15
        let ok = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            URLSession.shared.dataTask(with: request) { _, response, _ in
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                cont.resume(returning: (200..<300).contains(code))
            }.resume()
        }
        return ok
    }

    // ── internals ─────────────────────────────────────────────────

    private func currentOrRequestPermission() async -> String? {
        let current = await permissionStatus()
        // `nil` means no native push at all; asking would not change
        // that. Anything already decided is returned as decided,
        // because a second prompt is not something iOS shows anyway.
        guard let current else { return nil }
        if current == "undetermined" || current == "notDetermined" {
            return await withCheckedContinuation { cont in
                SentoriPushNotifications.shared.requestPermission { cont.resume(returning: $0) }
            }
        }
        return current
    }

    /// The token arrives asynchronously through the AppDelegate
    /// swizzle and lands in the native buffer, so this polls it. Any
    /// notifications or taps that arrive alongside are delivered
    /// rather than dropped on the floor.
    private func waitForToken(timeout: TimeInterval) async -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let state = SentoriPushNotifications.shared.drainState()
            flush(state)
            if let token = state["token"] as? String { return token }
            if state["error"] != nil { return nil }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        return nil
    }

    private func registerWithServer(token: String, config: SentoriConfig) async -> Result {
        guard let url = URL(string: "\(config.ingestUrl)/v1/push/tokens") else {
            return .failure(reason: .serverRejected, message: "bad ingest url")
        }
        var body: [String: Any] = [
            // `kind`, not `provider`. The React Native SDK sent
            // `provider` for a year and earned a 422 for every
            // registration it ever attempted.
            "kind": "apns",
            "nativeToken": token,
            // Sandbox and production APNs are different hosts, and a
            // token minted against one is rejected by the other.
            "env": isDebugBuild ? "sandbox" : "production",
        ]
        // The same salted-nothing hash every event carries, so the
        // dashboard can address this device by the person who hit an
        // issue. Absent until the host calls `Sentori.user`.
        if let userKey = SentoriScope.userKey { body["userKey"] = userKey }

        guard let payload = try? JSONSerialization.data(withJSONObject: body) else {
            return .failure(reason: .serverRejected, message: "could not encode registration")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.setValue("swift/\(SentoriVersion.current)", forHTTPHeaderField: "Sentori-Sdk")
        request.httpBody = payload
        request.timeoutInterval = 15

        return await withCheckedContinuation { (cont: CheckedContinuation<Result, Never>) in
            URLSession.shared.dataTask(with: request) { data, response, error in
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(code) else {
                    let why = error?.localizedDescription ?? "HTTP \(code)"
                    cont.resume(
                        returning: .failure(reason: .serverRejected, message: why))
                    return
                }
                // The handle is the `device_tokens` row id, a bare
                // uuid. The RN SDK parsed it as an `ipt_*` string no
                // server has ever returned.
                guard let data,
                    let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let handle = j["token_id"] as? String, !handle.isEmpty
                else {
                    cont.resume(
                        returning: .failure(
                            reason: .serverRejected,
                            message: "server returned no device token id"))
                    return
                }
                cont.resume(returning: .success(handle: handle))
            }.resume()
        }
    }

    /// 1 Hz while registered. The native side buffers arrivals and
    /// taps; this hands them to the host.
    private func startDrain() {
        lock.lock()
        defer { lock.unlock() }
        guard drainTimer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in
            guard let self else { return }
            self.flush(SentoriPushNotifications.shared.drainState())
        }
        drainTimer = t
        t.resume()
    }

    private func flush(_ state: [String: Any]) {
        lock.lock()
        let message = onMessage
        let tap = onTap
        lock.unlock()
        guard message != nil || tap != nil else { return }

        let notifications = state["notifications"] as? [[String: Any]] ?? []
        let taps = state["taps"] as? [[String: Any]] ?? []
        guard !notifications.isEmpty || !taps.isEmpty else { return }

        // The host's UI lives on the main thread and a notification
        // callback almost always touches it.
        DispatchQueue.main.async {
            notifications.forEach { message?($0) }
            taps.forEach { tap?($0) }
        }
    }

    private var isDebugBuild: Bool {
        #if DEBUG
            return true
        #else
            return false
        #endif
    }

    func __resetForTests() {
        lock.lock()
        cachedHandle = nil
        onMessage = nil
        onTap = nil
        drainTimer?.cancel()
        drainTimer = nil
        lock.unlock()
        UserDefaults.standard.removeObject(forKey: Self.handleKey)
    }
}

extension Sentori {
    /// `Sentori.push.register()`, matching `sentori.push.register()`
    /// in the React Native SDK.
    public static var push: SentoriPush { SentoriPush.shared }
}
