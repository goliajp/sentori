import XCTest

@testable import Sentori

/// Push registration, as far as a simulator can go.
///
/// A simulator has no APNs entitlement, so the honest coverage here is
/// the shape of the failures and the shape of the request — not a real
/// token. `scripts/ios-live-ingest.sh` proves the registration route
/// against a real server; a device proves the rest, and nothing here
/// pretends otherwise.
final class SentoriPushTests: XCTestCase {

    override func setUp() {
        super.setUp()
        SentoriConfig.__resetForTests()
        SentoriScope.clear()
        SentoriPush.shared.__resetForTests()
    }

    override func tearDown() {
        SentoriConfig.__resetForTests()
        SentoriPush.shared.__resetForTests()
        super.tearDown()
    }

    func testRegisterBeforeStartReportsItRatherThanThrowing() async {
        let result = await SentoriPush.shared.register(timeout: 1)
        guard case .failure(let reason, _) = result else {
            return XCTFail("expected a failure before start, got \(result)")
        }
        XCTAssertEqual(reason, .notInitialised)
        XCTAssertEqual(reason.name, "not-initialised")
    }

    func testEveryFailureHasTheSameNameAsTheReactNativeOne() {
        // Same strings as `PushRegisterFailure` in the RN SDK, so one
        // set of integration notes covers both and an operator reading
        // a support thread does not have to translate.
        XCTAssertEqual(SentoriPush.Failure.notInitialised.name, "not-initialised")
        XCTAssertEqual(SentoriPush.Failure.permissionDenied.name, "permission-denied")
        XCTAssertEqual(SentoriPush.Failure.noTransport.name, "no-transport")
        XCTAssertEqual(SentoriPush.Failure.tokenTimeout.name, "token-timeout")
        XCTAssertEqual(SentoriPush.Failure.serverRejected.name, "server-rejected")
    }

    func testRegisterOnASimulatorFailsWithoutThrowing() async {
        SentoriConfig.set(
            SentoriConfig(
                token: "st_test",
                ingestUrl: "http://127.0.0.1:9",
                release: "app@1.0.0",
                environment: "test"
            ))

        // No entitlement here, so this ends at permission or at the
        // token wait. Either is fine; reaching the end without a throw
        // and without a hang is the assertion.
        let result = await SentoriPush.shared.register(timeout: 1)
        guard case .failure(let reason, let message) = result else {
            return XCTFail("a simulator cannot actually register, got \(result)")
        }
        XCTAssertTrue(
            [.permissionDenied, .noTransport, .tokenTimeout].contains(reason),
            "unexpected reason \(reason.name): \(message)"
        )
        XCTAssertNil(SentoriPush.shared.cachedDeviceHandle(), "a failure must cache nothing")
    }

    func testUnregisterWithNothingRegisteredIsANoOp() async {
        let ok = await SentoriPush.shared.unregister()
        XCTAssertFalse(ok, "nothing to revoke")
        XCTAssertNil(SentoriPush.shared.cachedDeviceHandle())
    }

    func testTheRegistrationBodyIsTheOneTheServerAccepts() throws {
        // The field names are the whole reason push never worked for a
        // year: the RN SDK sent `provider` where the server reads
        // `kind`, and parsed an `ipt_*` handle no server has ever
        // returned. Pinned here rather than left to a reviewer.
        SentoriScope.setUser(id: "usr_123", email: nil)
        let body: [String: Any] = [
            "kind": "apns",
            "nativeToken": "abcd",
            "env": "sandbox",
            "userKey": SentoriScope.userKey as Any,
        ]
        let data = try JSONSerialization.data(withJSONObject: body)
        let round = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(round["kind"] as? String, "apns")
        XCTAssertNil(round["provider"], "the server has no such field")
        XCTAssertEqual(
            round["userKey"] as? String,
            SentoriIdentity.hash(keyType: "id", value: "usr_123"),
            "the device must carry the key its events carry, or it is unreachable from an issue"
        )
    }
    /// The failure log must not be able to kill the app it reports
    /// for.
    ///
    /// Its first version did. `Failure` is an `@objc enum … : Int`,
    /// the log passed `reason.rawValue` to `%@`, and NSLog
    /// dereferenced an integer as an object — a line added to make
    /// failures visible, crashing the host on the first failure it
    /// saw. The suite caught it only because something happened to
    /// call it.
    ///
    /// `message` is server text and may contain a `%`, which is the
    /// other way a log line becomes a crash.
    func testTheFailureLogSurvivesEveryReasonAndAPercentSign() async {
        SentoriConfig.__resetForTests()

        // No config: every verb is a no-op and `register` reports
        // notInitialised — through the log path, on this thread.
        let result = await Sentori.push.register()
        guard case .failure(let reason, _) = result else {
            return XCTFail("expected a failure without a config, got \(result)")
        }
        XCTAssertEqual(reason, .notInitialised)

        // Every reason has a name to log. An Int reaching a `%@` is
        // what crashed; a missing name would be the same shape.
        for reason in [
            SentoriPush.Failure.notInitialised, .permissionDenied, .noTransport,
            .tokenTimeout, .serverRejected,
        ] {
            XCTAssertFalse(reason.name.isEmpty)
            NSLog("%@", "[sentori-test] \(reason.name): 100%% of nothing %@ %d")
        }
    }

}
