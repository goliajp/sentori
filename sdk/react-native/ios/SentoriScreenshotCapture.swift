import Foundation
import UIKit

/// Phase 42 sub-E.01/02/06 — capture the current screen + view tree
/// at native crash time.
///
/// Lives separately from `SentoriCrashHandler` so it can also be
/// invoked imperatively from the JS bridge (`captureNativeScreenshot`)
/// when a non-fatal native error fires and we still want the
/// "Captured at error" gallery to fill in.
///
/// Output shape — matches `protocol.md` attachment schema:
///
///     {
///       "screenshot": { "base64": "...", "mediaType": "image/jpeg" },
///       "viewTree":   { "rootId": "n1", "nodes": { ... } }
///     }
///
/// The crash handler base64-encodes both blobs and stuffs them into
/// the event JSON under `_pendingAttachments` so the JS side can
/// upload them on next launch via the standard
/// `POST /v1/events/<id>/attachments/<kind>` path.
///
/// Why not WebP: iOS < 14 has no system WebP encoder. JPEG q=70
/// matches the JS-side decision (sub-D.03); the size budget is the
/// same 500 KB hard limit on the server.
///
/// Why not a 5s background cache (yet): the only iOS native crash
/// path we capture today is `NSSetUncaughtExceptionHandler`, which
/// fires before the app fully tears down and where UIKit is still
/// valid. Signal-based crashes (SIGSEGV / SIGABRT) would need the
/// cache approach because signal handlers can't touch UIKit safely —
/// the cache layer will land alongside any future signal-crash work.
@objc public final class SentoriScreenshotCapture: NSObject {

    /// 480 px on the long edge keeps a typical screenshot under 100 KB
    /// JPEG-encoded; well under the 500 KB attachment hard limit and
    /// big enough to read text on a phone-sized canvas.
    private static let maxLongEdgePx: CGFloat = 480
    private static let jpegQuality: CGFloat = 0.7
    /// Depth-limited tree walk: matches the JS / dashboard
    /// `viewTree` schema in sub-G and bounds payload size.
    private static let maxTreeDepth: Int = 10
    /// Hard cap on the number of nodes we serialize even within
    /// depth=10 — protects against unbounded recyclers / list views.
    private static let maxNodes: Int = 1500

    /// Capture screenshot + view tree of the key window. Bounces to
    /// the main thread synchronously if invoked from elsewhere
    /// (UIKit drawing is main-thread-only). Returns `nil` when
    /// there's no window available (backgrounded, before scene
    /// attached, etc.).
    @objc public static func captureKeyWindow() -> [String: Any]? {
        if Thread.isMainThread {
            return captureSync()
        }
        var result: [String: Any]?
        DispatchQueue.main.sync {
            result = captureSync()
        }
        return result
    }

    // MARK: - Internals

    private static func captureSync() -> [String: Any]? {
        guard let window = keyWindow() else { return nil }
        var out: [String: Any] = [:]
        if let jpeg = renderJpegBase64(window: window) {
            out["screenshot"] = [
                "base64": jpeg,
                "mediaType": "image/jpeg",
            ]
        }
        out["viewTree"] = walkTree(root: window)
        return out.isEmpty ? nil : out
    }

    private static func keyWindow() -> UIWindow? {
        if #available(iOS 13.0, *) {
            for scene in UIApplication.shared.connectedScenes {
                guard let ws = scene as? UIWindowScene else { continue }
                if let key = ws.windows.first(where: { $0.isKeyWindow }) {
                    return key
                }
                if let first = ws.windows.first {
                    return first
                }
            }
        }
        // Fallback (pre-iOS 13 multi-scene shape)
        return UIApplication.shared.windows.first
    }

    private static func renderJpegBase64(window: UIWindow) -> String? {
        let bounds = window.bounds
        let longEdge = max(bounds.width, bounds.height)
        let scale: CGFloat = longEdge > maxLongEdgePx ? maxLongEdgePx / longEdge : 1.0
        let outSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        guard outSize.width > 1, outSize.height > 1 else { return nil }

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1.0
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: outSize, format: format)
        let image = renderer.image { _ in
            window.drawHierarchy(
                in: CGRect(origin: .zero, size: outSize),
                afterScreenUpdates: false
            )
        }
        guard let data = image.jpegData(compressionQuality: jpegQuality) else {
            return nil
        }
        return data.base64EncodedString()
    }

    private static func walkTree(root: UIView) -> [String: Any] {
        var nodes: [String: Any] = [:]
        var counter = 0
        var nodeCount = 0

        func nextId() -> String {
            counter += 1
            return "n\(counter)"
        }

        func walk(view: UIView, depth: Int) -> String {
            let id = nextId()
            nodeCount += 1
            var childIds: [String] = []
            if depth < maxTreeDepth && nodeCount < maxNodes {
                for sv in view.subviews {
                    if nodeCount >= maxNodes { break }
                    childIds.append(walk(view: sv, depth: depth + 1))
                }
            }
            let className = String(describing: type(of: view))
            let frame = view.frame
            var propsSummary: [String: String] = [
                "frame": String(
                    format: "%.0f,%.0f,%.0f,%.0f",
                    frame.origin.x, frame.origin.y,
                    frame.size.width, frame.size.height
                ),
                "alpha": String(format: "%.2f", view.alpha),
                "hidden": view.isHidden ? "true" : "false",
            ]
            if let label = view.accessibilityLabel, !label.isEmpty {
                // 200-byte cap matches sub-G dashboard / protocol budget.
                propsSummary["accessibilityLabel"] =
                    String(label.prefix(200))
            }
            nodes[id] = [
                "type": "UIView",
                "name": className,
                "props_summary": propsSummary,
                "children": childIds,
            ]
            return id
        }

        let rootId = walk(view: root, depth: 0)
        return [
            "rootId": rootId,
            "nodes": nodes,
        ]
    }
}
