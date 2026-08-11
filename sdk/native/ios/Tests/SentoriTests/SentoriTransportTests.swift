import XCTest

@testable import Sentori

/// The transport carries the client zero-cost rule, and in Swift it
/// carries it without a JS event loop underneath. These assert the
/// parts an integrator would feel: the call returns immediately, it
/// never throws, and neither the queue nor the spill file can grow
/// without limit.
final class SentoriTransportTests: XCTestCase {

    override func setUp() {
        super.setUp()
        SentoriTransport.__resetForTests()
        SentoriConfig.__resetForTests()
        SentoriScope.clear()
        SentoriSignalRing.clear()
    }

    override func tearDown() {
        SentoriTransport.__resetForTests()
        SentoriConfig.__resetForTests()
        super.tearDown()
    }

    private func configure(url: String = "http://127.0.0.1:9") {
        SentoriConfig.set(
            SentoriConfig(
                token: "st_test",
                ingestUrl: url,
                release: "app@1.0.0",
                environment: "test"
            ))
    }

    func testEnqueueBeforeInitIsASilentNoOpRatherThanACrash() {
        // No config: the whole SDK is a no-op. This is the state a
        // mis-wired token leaves an app in, and it must be boring.
        SentoriTransport.enqueue(["kind": "error"])
        SentoriTransport.flush()
        XCTAssertEqual(SentoriTransport.__peekQueue().count, 1, "queued, but nothing sent")
    }

    func testEnqueueReturnsWithoutWaitingOnTheNetwork() {
        configure()
        SentoriTransport.start()

        // 10 events trips the batch size and starts a send to a port
        // nothing listens on. The call must still return in well under
        // the connect timeout — the whole point is that the caller's
        // thread is never the one waiting.
        let start = Date()
        for i in 0..<10 { SentoriTransport.enqueue(["kind": "error", "seq": i]) }
        let elapsed = Date().timeIntervalSince(start)

        XCTAssertLessThan(
            elapsed, 0.05,
            "enqueue took \(elapsed)s — it is doing work that belongs on the worker"
        )
    }

    func testTheQueueIsBounded() {
        configure()
        // Deliberately not started: nothing drains, so this measures
        // the cap rather than a race with the flusher.
        for i in 0..<2000 { SentoriTransport.enqueue(["kind": "trace", "seq": i]) }

        let queued = SentoriTransport.__peekQueue()
        XCTAssertLessThanOrEqual(
            queued.count, 500,
            "an unbounded queue is a leak with a nicer name"
        )
        // Oldest go first: the crash happening now matters more than
        // the one from ten minutes ago.
        XCTAssertEqual(queued.last?["seq"] as? Int, 1999)
    }

    func testAssertOutcomesAggregateInsteadOfBecomingEvents() {
        configure()
        for _ in 0..<5 { SentoriTransport.countAssert(name: "cart.total", ok: true, release: "r1") }
        SentoriTransport.countAssert(name: "cart.total", ok: false, release: "r1")
        SentoriTransport.countAssert(name: "cart.total", ok: true, release: "r2")

        XCTAssertTrue(
            SentoriTransport.__peekQueue().isEmpty,
            "a passing assert must never become an event — that is the heartbeat flood"
        )
        let stats = SentoriTransport.__peekAssertStats()
        XCTAssertEqual(stats.count, 2, "one row per (name, release)")

        let r1 = stats.first { $0["release"] as? String == "r1" }
        XCTAssertEqual(r1?["passDelta"] as? Int, 5)
        XCTAssertEqual(r1?["failDelta"] as? Int, 1)
    }

    func testAFailedSendSpillsToDiskAndDrainsOnTheNextStart() {
        configure()
        SentoriTransport.start()
        for i in 0..<3 { SentoriTransport.enqueue(["kind": "error", "seq": i]) }
        SentoriTransport.flush()

        // The send is to a closed port; give the retries their three
        // attempts before looking.
        let spilled = expectation(description: "spilled")
        DispatchQueue.global().asyncAfter(deadline: .now() + 8) { spilled.fulfill() }
        wait(for: [spilled], timeout: 12)

        XCTAssertEqual(
            SentoriTransport.__peekPersisted().count, 3,
            "events must survive being offline"
        )

        // A fresh process: the spill goes back through the normal path
        // and the file is cleared, so a second failure spills once
        // rather than doubling.
        SentoriConfig.__resetForTests()
        SentoriTransport.start()
        let drained = expectation(description: "drained")
        DispatchQueue.global().asyncAfter(deadline: .now() + 1) { drained.fulfill() }
        wait(for: [drained], timeout: 5)
        XCTAssertEqual(SentoriTransport.__peekQueue().count, 3, "the spill came back")
        XCTAssertTrue(SentoriTransport.__peekPersisted().isEmpty, "and the file was cleared")
    }

    func testGarbageNeverThrows() {
        configure()
        SentoriTransport.start()
        // Values JSONSerialization cannot encode. The verb contract is
        // that nothing here reaches the host, so the worst outcome is
        // a batch that does not go out.
        SentoriTransport.enqueue(["kind": "error", "bad": Double.nan])
        SentoriTransport.enqueue(["kind": "error", "date": Date()])
        SentoriTransport.enqueue([:])
        SentoriTransport.flush()
        // Reaching here without a crash is the assertion.
        XCTAssertTrue(true)
    }
}
