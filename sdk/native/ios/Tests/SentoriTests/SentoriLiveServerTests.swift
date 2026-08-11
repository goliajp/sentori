import XCTest

@testable import Sentori

/// Against a real Sentori server, not a mock.
///
/// Everything else in this suite asserts the shape this SDK *builds*.
/// That is worth nothing if the server rejects it, and a mock would
/// agree with whatever mistake the SDK is making — which is how a
/// wire format quietly diverges. The one thing that cannot agree with
/// a mistake is the server.
///
/// Skipped unless `SENTORI_TEST_BASE` and `SENTORI_TEST_TOKEN` are
/// set, so a plain `xcodebuild test` stays offline. CI's
/// `ios-live-ingest` job sets them against a `docker compose` stack.
/// A skip says so out loud: a test that silently passes when it did
/// not run is worse than no test.
final class SentoriLiveServerTests: XCTestCase {

    private var base: String!
    private var token: String!

    /// Written by whoever brought a server up — `scripts/ios-live-ingest.sh`
    /// locally and in CI. Not environment variables: neither a plain
    /// `xcodebuild` invocation nor `SIMCTL_CHILD_*` reaches the test
    /// runner inside the simulator, so the first version of this
    /// skipped every time while reporting TEST SUCCEEDED. A file the
    /// runner can read is the part of the host filesystem a simulator
    /// definitely has.
    private static var configURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // SentoriTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // native
            .appendingPathComponent("fixtures/live-server.json")
    }

    override func setUpWithError() throws {
        guard let data = try? Data(contentsOf: Self.configURL),
            let j = try? JSONSerialization.jsonObject(with: data) as? [String: String],
            let b = j["base"], let t = j["token"], !b.isEmpty, !t.isEmpty
        else {
            throw XCTSkip(
                "no sdk/native/fixtures/live-server.json — run scripts/ios-live-ingest.sh")
        }
        base = b
        token = t
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

    func testTheServerAcceptsWhatThisSDKSends() throws {
        Sentori.start(
            SentoriConfig(
                token: token,
                ingestUrl: base,
                release: "swift-e2e@1.0.0",
                environment: "test"
            ))
        Sentori.user(id: "usr_swift_1", email: nil)
        Sentori.context(["tenant": "acme"])
        Sentori.pushSignal(kind: "nav", data: ["to": "/checkout"])

        let id = Sentori.error(
            NSError(domain: "SwiftE2E", code: 42, userInfo: [NSLocalizedDescriptionKey: "boom"]),
            data: ["cartId": "c_1"]
        )
        Sentori.warn("checkout.slow", data: ["ms": 3200])
        Sentori.assert("total.positive", false)
        Sentori.probe("SEN-482")
        SentoriTransport.flush()

        // The batch goes out on the worker; give it the round trip.
        let sent = expectation(description: "sent")
        DispatchQueue.global().asyncAfter(deadline: .now() + 3) { sent.fulfill() }
        wait(for: [sent], timeout: 10)

        XCTAssertTrue(
            SentoriTransport.__peekPersisted().isEmpty,
            "the server refused the batch — it spilled to disk instead of being accepted"
        )
        XCTAssertTrue(
            SentoriTransport.__peekQueue().isEmpty,
            "the batch never left the queue"
        )
        XCTAssertEqual(id.count, 36)
    }
}
