import Foundation

/// The only place the SDK talks to the network.
///
/// Ported from `sdk/react-native/src/transport.ts`, which is the
/// behaviour the server's e2e already asserts: batch on a 5 s timer or
/// a 10-deep queue, whichever comes first; three attempts with a
/// doubling delay; a 429 waits out `retryAfterMs`; anything left after
/// that spills to disk and drains on the next launch.
///
/// The iron rule is harder here than in JavaScript. A JS verb can
/// return immediately because everything after it is a microtask;
/// Swift has no such floor, so "fire and forget" has to be a real
/// queue on a real background thread. `enqueue` therefore does one
/// bounded append under a lock and returns — no encoding, no I/O, no
/// allocation beyond the event itself. Everything expensive happens on
/// `worker`.
///
/// Nothing in this file throws to the caller, and nothing blocks it.
@objc(SentoriTransport)
public final class SentoriTransport: NSObject {

    // Matching transport.ts, so a batch from an iOS app and a batch
    // from a React Native app look the same to the server and to the
    // person reading the dashboard.
    private static let flushInterval: TimeInterval = 5
    private static let batchSize = 10
    private static let maxRetry = 3
    private static let maxPersisted = 1000

    /// Bounded, because an unbounded in-memory queue is a leak with a
    /// nicer name. At the batch size above this is ~50 flushes of
    /// backlog; past it the oldest events go, since a crash from ten
    /// minutes ago matters less than the one happening now.
    private static let maxQueued = 500

    /// Per-attempt request timeout. A test seam: the spill test used
    /// to rely on a closed port being refused instantly, which is true
    /// on a laptop and false on a CI runner that drops the packet
    /// instead — three 15 s attempts there, and the test timed out
    /// waiting for a spill that was still 20 s away.
    static var requestTimeout: TimeInterval = 15

    private static let lock = NSLock()
    private static var queue: [[String: Any]] = []
    private static var assertStats: [String: [String: Any]] = [:]
    private static var timer: DispatchSourceTimer?
    private static var started = false
    private static var dropped = 0
    private static var delivered = 0

    private static let worker = DispatchQueue(label: "jp.golia.sentori.transport", qos: .utility)

    /// O(1) on the calling thread: append, maybe schedule. Everything
    /// else is the worker's problem.
    @objc public static func enqueue(_ event: [String: Any]) {
        lock.lock()
        queue.append(event)
        if queue.count > maxQueued {
            queue.removeFirst(queue.count - maxQueued)
            dropped += 1
        }
        let due = queue.count >= batchSize
        lock.unlock()

        if due {
            worker.async { flush() }
        } else {
            scheduleFlush(after: flushInterval)
        }
    }

    /// Assert outcomes aggregate rather than becoming events, and ride
    /// whatever batch goes out next — the liveness ledger without a
    /// heartbeat flood. A run with only passing asserts still reports,
    /// on a lazy timer six times the batch interval.
    @objc public static func countAssert(name: String, ok: Bool, release: String) {
        let key = "\(name)\u{1f}\(release)"
        lock.lock()
        var stat =
            assertStats[key] ?? ["name": name, "release": release, "passDelta": 0, "failDelta": 0]
        let field = ok ? "passDelta" : "failDelta"
        stat[field] = ((stat[field] as? Int) ?? 0) + 1
        assertStats[key] = stat
        let idle = queue.isEmpty
        lock.unlock()

        if idle { scheduleFlush(after: flushInterval * 6) }
    }

    @objc public static func start() {
        lock.lock()
        started = true
        lock.unlock()
        worker.async { drainPersisted() }
    }

    /// Send everything queued. Safe to call from anywhere; runs on the
    /// worker.
    @objc public static func flush() {
        // Before touching the queue, not after. The first version of
        // this drained into a local, cleared the queue, and only then
        // looked for a config — so anything enqueued before `start`
        // was silently destroyed by the first flush instead of waiting
        // for init. `transport.ts` checks in this order for the same
        // reason.
        guard let config = SentoriConfig.current else { return }

        lock.lock()
        guard started, !queue.isEmpty || !assertStats.isEmpty else {
            lock.unlock()
            return
        }
        let events = queue
        let stats = Array(assertStats.values)
        let lost = dropped
        queue.removeAll(keepingCapacity: true)
        assertStats.removeAll(keepingCapacity: true)
        dropped = 0
        timer?.cancel()
        timer = nil
        lock.unlock()

        var envelope: [String: Any] = ["events": events]
        if !stats.isEmpty { envelope["assertStats"] = stats }
        if let health = config.backendHealthUrl { envelope["backendHealthUrl"] = health }
        // Say so rather than let the gap look like quiet. A backlog
        // that overflowed is a fact about the device, and hiding it
        // makes the next person read a hole in the timeline as calm.
        if lost > 0 { envelope["droppedEvents"] = lost }

        worker.async {
            switch sendWithRetry(envelope, config: config) {
            case .delivered:
                lock.lock()
                delivered += events.count
                lock.unlock()
            case .dropped:
                // Handled, but not accepted. Nothing to retry and
                // nothing to count.
                break
            default:
                persist(events)
            }
        }
    }

    // ── the network ───────────────────────────────────────────────

    /// Returns the terminal outcome rather than a bool.
    ///
    /// It used to return "stop trying", which conflated *accepted*
    /// with *rejected for good reason*: a 4xx is not worth retrying,
    /// but it is also not delivery. With one bool, a wrong token
    /// looked exactly like a successful send — the live suite passed
    /// against a server that had stored nothing, and only a readback
    /// through the admin API noticed.
    private static func sendWithRetry(_ envelope: [String: Any], config: SentoriConfig) -> Outcome
    {
        var delay: TimeInterval = 1
        for attempt in 1...maxRetry {
            let outcome = sendOnce(envelope, config: config)
            switch outcome {
            case .delivered, .dropped:
                // A 4xx that is not 429 is our request being wrong.
                // Retrying produces the same 4xx forever, so it ends
                // here rather than spilling and trying again on every
                // launch.
                return outcome
            case .retryAfter(let wait):
                if attempt == maxRetry { return outcome }
                Thread.sleep(forTimeInterval: wait)
            case .failed:
                if attempt == maxRetry { return outcome }
                Thread.sleep(forTimeInterval: delay)
                delay *= 2
            }
        }
        return .failed
    }

    private enum Outcome {
        case delivered
        case dropped
        case retryAfter(TimeInterval)
        case failed
    }

    private static func sendOnce(_ envelope: [String: Any], config: SentoriConfig) -> Outcome {
        guard let url = URL(string: "\(config.ingestUrl)/v1/events:batch"),
            let body = try? JSONSerialization.data(withJSONObject: envelope)
        else { return .dropped }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.setValue("swift/\(SentoriVersion.current)", forHTTPHeaderField: "Sentori-Sdk")
        request.httpBody = body
        request.timeoutInterval = requestTimeout

        // The worker thread is ours and is not the caller's, so
        // blocking it is fine and keeps the retry loop readable.
        let semaphore = DispatchSemaphore(value: 0)
        var outcome = Outcome.failed
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse else { return }
            switch http.statusCode {
            case 200..<300:
                outcome = .delivered
            case 429:
                var wait: TimeInterval = 5
                if let data,
                    let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let ms = j["retryAfterMs"] as? Double
                {
                    wait = ms / 1000
                }
                outcome = .retryAfter(wait)
            case 500...:
                outcome = .failed
            default:
                outcome = .dropped
            }
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 30)
        return outcome
    }

    // ── the offline queue ─────────────────────────────────────────

    private static var spillURL: URL? {
        guard
            let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
                .first
        else { return nil }
        let sentori = dir.appendingPathComponent("sentori", isDirectory: true)
        try? FileManager.default.createDirectory(at: sentori, withIntermediateDirectories: true)
        return sentori.appendingPathComponent("pending-events.json")
    }

    private static func persist(_ events: [[String: Any]]) {
        guard let url = spillURL else { return }
        var all = readPersisted()
        all.append(contentsOf: events)
        // Newest wins: the same reasoning as the in-memory cap, and
        // the file has to stop growing on a device that is offline for
        // a week.
        if all.count > maxPersisted { all.removeFirst(all.count - maxPersisted) }
        guard let data = try? JSONSerialization.data(withJSONObject: all) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private static func readPersisted() -> [[String: Any]] {
        guard let url = spillURL, let data = try? Data(contentsOf: url),
            let all = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { return [] }
        return all
    }

    /// Called once on start. Reads the spill, clears it, and puts the
    /// events back through the normal path — clearing first, so a
    /// batch that fails again spills once rather than doubling.
    private static func drainPersisted() {
        let pending = readPersisted()
        guard !pending.isEmpty, let url = spillURL else { return }
        try? FileManager.default.removeItem(at: url)
        for event in pending { enqueue(event) }
        flush()
    }

    // ── timer ─────────────────────────────────────────────────────

    private static func scheduleFlush(after seconds: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        guard timer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: worker)
        t.schedule(deadline: .now() + seconds)
        t.setEventHandler {
            lock.lock()
            timer = nil
            lock.unlock()
            flush()
        }
        timer = t
        t.resume()
    }

    // ── test seams ────────────────────────────────────────────────

    static func __resetForTests() {
        lock.lock()
        queue.removeAll()
        assertStats.removeAll()
        dropped = 0
        delivered = 0
        started = false
        requestTimeout = 15
        timer?.cancel()
        timer = nil
        lock.unlock()
        if let url = spillURL { try? FileManager.default.removeItem(at: url) }
    }

    static func __peekQueue() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return queue
    }

    static func __peekAssertStats() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return Array(assertStats.values)
    }

    static func __peekPersisted() -> [[String: Any]] { readPersisted() }

    /// Events the server actually accepted. A test that checks only
    /// for the *absence* of a spill passes while three retries are
    /// still in flight — which is how the live suite went green on CI
    /// against a server that had stored nothing.
    static func __peekDelivered() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return delivered
    }
}
