// Phase 29 sub-A step 3: XCTest coverage for SentoriThreadSampler.
//
// Run via Xcode (target → SentoriTests, ⌘U) or via xcodebuild from the
// iOS host:
//   xcodebuild test \
//     -scheme SentoriTests \
//     -destination 'platform=iOS Simulator,name=iPhone 15'
//
// On Apple Silicon Mac the simulator runs the arm64 slice and the
// sampler can walk frames; on Intel Mac the simulator slice is x86_64
// and the sampler returns []. Both paths are asserted below.

import XCTest

@testable import Sentori

final class SentoriThreadSamplerTests: XCTestCase {

    override func setUp() {
        super.setUp()
        // Capture the main pthread → mach port mapping. setUp runs on
        // the test runner's main queue, which is the main thread.
        SentoriThreadSampler.installMainThreadHandle()
    }

    /// Recurse to a known depth and run `leaf` at the bottom, so the
    /// main thread has a stack this test controls rather than whatever
    /// the runner happened to be doing.
    ///
    /// `@inline(never)` and the `withExtendedLifetime` keep the frames
    /// from being folded away; test targets build `-Onone`, so this is
    /// belt and braces.
    @inline(never)
    private func recurse(_ depth: Int, _ leaf: () -> Void) {
        if depth == 0 {
            leaf()
            return
        }
        recurse(depth - 1, leaf)
        withExtendedLifetime(depth) {}
    }

    /// Background → sampler → main: walks a real chain off the main
    /// thread.
    ///
    /// This asserted `≥ 5` frames against whatever depth the XCTest
    /// runner's main thread happened to have at that instant — a
    /// property the test did not control and does not own. Measured
    /// over 12 runs it failed twice, returning 1 and 2 frames: the
    /// sampler was working and the assertion was about the weather.
    ///
    /// A gate that reds one run in six is a gate people learn to
    /// re-run, so the fix is to make the premise true rather than to
    /// lower the bar. The main thread is parked 24 frames deep on a
    /// semaphore while the sample is taken, so ≥ 5 is now a statement
    /// about the sampler.
    func testCaptureFromBackgroundWalksADeepMainStack() {
        let ready = DispatchSemaphore(value: 0)
        let sampled = DispatchSemaphore(value: 0)
        var frames: [NSNumber] = []

        DispatchQueue.global(qos: .userInitiated).async {
            ready.wait()
            frames = SentoriThreadSampler.captureMainThreadFrames(maxFrames: 64)
            sampled.signal()
        }

        recurse(24) {
            ready.signal()
            _ = sampled.wait(timeout: .now() + 5)
        }

        #if arch(arm64)
            XCTAssertGreaterThanOrEqual(
                frames.count, 5,
                "24 frames were parked on the main thread; sampler returned \(frames.count)"
            )
            XCTAssertGreaterThan(
                frames.first?.uint64Value ?? 0, 0,
                "first PC must be non-zero"
            )
            XCTAssertLessThanOrEqual(
                frames.count, 64,
                "must respect maxFrames cap"
            )
        #else
            // Intel simulator: sampler returns empty by design.
            XCTAssertEqual(frames.count, 0)
        #endif
    }

    /// Sampling from main itself must refuse — would race with our own
    /// register state.
    func testCaptureFromMainReturnsEmpty() {
        let frames = SentoriThreadSampler.captureMainThreadFrames(maxFrames: 64)
        XCTAssertEqual(
            frames.count, 0,
            "sampling from main must return [] (would race with own state)"
        )
    }

    /// `installMainThreadHandle` must be safe to call repeatedly.
    func testInstallIsIdempotent() {
        SentoriThreadSampler.installMainThreadHandle()
        SentoriThreadSampler.installMainThreadHandle()
        SentoriThreadSampler.installMainThreadHandle()

        let exp = expectation(description: "still works after re-install")
        DispatchQueue.global().async {
            let frames = SentoriThreadSampler.captureMainThreadFrames(maxFrames: 16)
            #if arch(arm64)
                XCTAssertGreaterThan(
                    frames.count, 0,
                    "re-installs must not break the captured handle"
                )
            #endif
            exp.fulfill()
        }
        wait(for: [exp], timeout: 2.0)
    }

    /// `maxFrames: 0` returns empty even on arm64.
    func testZeroMaxFramesReturnsEmpty() {
        let exp = expectation(description: "zero max")
        DispatchQueue.global().async {
            let frames = SentoriThreadSampler.captureMainThreadFrames(maxFrames: 0)
            XCTAssertEqual(frames.count, 0)
            exp.fulfill()
        }
        wait(for: [exp], timeout: 2.0)
    }
}
