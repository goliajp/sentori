import XCTest

@testable import Sentori

final class SentoriStackTests: XCTestCase {
    func testCaptureReturnsAddressesAndIsBounded() {
        let addresses = SentoriStack.capture(skip: 0)
        XCTAssertFalse(addresses.isEmpty, "a test runs on a real stack; zero frames means the walk failed")
        XCTAssertLessThanOrEqual(addresses.count, SentoriStack.maxDepth)
    }

    func testSkipDropsOurOwnFrames() {
        // Comparing counts would prove nothing: both are capped at
        // maxDepth on a stack this deep. What `skip` means is which
        // frame comes first.
        let full = SentoriStack.capture(skip: 0)
        let skipped = SentoriStack.capture(skip: 2)
        XCTAssertGreaterThan(full.count, 2)
        XCTAssertEqual(skipped.first, full[2])
    }

    func testResolveNamesTheFunctionItWasCalledFrom() {
        let frames = SentoriStack.resolve(SentoriStack.capture(skip: 0))
        XCTAssertFalse(frames.isEmpty)
        let functions = frames.compactMap { $0["function"] as? String }
        XCTAssertTrue(
            functions.contains { $0.contains("testResolveNamesTheFunctionItWasCalledFrom") },
            "the frame this call was made from is not in \(functions.prefix(6))"
        )
        // Every frame carries the shape the wire expects, resolved or not.
        for frame in frames {
            XCTAssertNotNil(frame["function"] as? String)
            XCTAssertNotNil(frame["file"] as? String)
            XCTAssertNotNil(frame["inApp"] as? Bool)
            XCTAssertEqual(frame["line"] as? Int, 0)
        }
    }

    func testAFrameCarriesTheImageItsAddressBelongsTo() {
        // Without these the server cannot reach the release's dSYM,
        // and a native stack stays a column of hex.
        let frames = SentoriStack.resolve(SentoriStack.capture(skip: 0))
        let withImage = frames.filter { $0["imageUuid"] != nil && $0["imageBase"] != nil }
        XCTAssertFalse(withImage.isEmpty, "no frame carried an image identity")
        let uuid = withImage[0]["imageUuid"] as? String
        XCTAssertEqual(uuid?.count, 32, "a UUID is 32 hex characters, no dashes: \(uuid ?? "nil")")
        XCTAssertEqual(uuid, uuid?.lowercased())
    }

    func testSystemFramesAreNotInApp() {
        XCTAssertFalse(SentoriStack.isApp("UIKitCore"))
        XCTAssertFalse(SentoriStack.isApp("libsystem_kernel.dylib"))
        XCTAssertTrue(SentoriStack.isApp("MyApp"))
    }

    func testAMangledNameComesBackReadable() {
        // A dashboard showing `$s7Sentori...` is showing nothing.
        // A real mangled name, not one written by hand: the runtime
        // returns anything it cannot parse unchanged, so an invented
        // string makes this test pass by failing to be a test.
        XCTAssertEqual(SentoriStack.demangle("$sSi"), "Swift.Int")
        // An Objective-C selector is already readable and must survive.
        XCTAssertEqual(SentoriStack.demangle("-[UIViewController viewDidLoad]"),
                       "-[UIViewController viewDidLoad]")
    }

    /// Iron rule, dimension 1: a verb the host calls from a tap
    /// handler may not cost it a frame. Capture is the part that runs
    /// on the caller's thread.
    func testCaptureCostsFarLessThanAFrame() {
        let iterations = 1000
        let start = CFAbsoluteTimeGetCurrent()
        for _ in 0..<iterations { _ = SentoriStack.capture(skip: 0) }
        let perCall = (CFAbsoluteTimeGetCurrent() - start) / Double(iterations) * 1000
        print("SentoriStack.capture: \(String(format: "%.4f", perCall)) ms/call")
        XCTAssertLessThan(perCall, 0.5, "capture costs \(perCall) ms on the calling thread")
    }

    func testResolveCost() {
        let addresses = SentoriStack.capture(skip: 0)
        let iterations = 200
        let start = CFAbsoluteTimeGetCurrent()
        for _ in 0..<iterations { _ = SentoriStack.resolve(addresses) }
        let perCall = (CFAbsoluteTimeGetCurrent() - start) / Double(iterations) * 1000
        print("SentoriStack.resolve(\(addresses.count) frames): \(String(format: "%.4f", perCall)) ms/call")
        XCTAssertLessThan(perCall, 5.0, "resolve costs \(perCall) ms")
    }
}

/// The two halves of the crash handler and the error verb now share
/// one image walk. They used to have two, and they disagreed on the
/// case of the hex — which the server normalises, so the difference
/// would never have surfaced as a failure, only as two answers to the
/// same question.
final class SentoriImageTests: XCTestCase {
    func testTheUuidIsTheFormTheServerMatchesOn() {
        var info = Dl_info()
        let here = SentoriStack.capture(skip: 0)
        XCTAssertFalse(here.isEmpty)
        guard dladdr(UnsafeRawPointer(bitPattern: here[0].uintValue), &info) != 0,
              let base = info.dli_fbase,
              let uuid = SentoriImage.uuid(atBase: base)
        else {
            return XCTFail("no image identity for the frame this test runs in")
        }
        XCTAssertEqual(uuid.count, 32)
        XCTAssertEqual(uuid, uuid.lowercased())
        XCTAssertFalse(uuid.contains("-"))
    }
}
