import Foundation
import UIKit

/// v0.9.6 #2 — wireframe session replay (iOS side).
///
/// Walks the UIView hierarchy at 1 Hz and serializes each visible
/// node as a compact JSON dict:
///   { kind, x, y, w, h, text?, color? }
///
/// Mask: nodes whose `accessibilityIdentifier` matches the JS-side
/// mask registry (passed in as `maskedIds`) have their text replaced
/// with "***" and the masked flag set so descendants render as
/// black-filled rects in the dashboard player.
///
/// Output: one JSON object per snapshot, returned as a string. The
/// JS side appends each snapshot to a 60-slot ring buffer; on
/// `captureException` the ring is uploaded as a `replay` attachment
/// (NDJSON: one snapshot per line).
@objc public final class SentoriReplayCapture: NSObject {

    @objc public static func captureWireframe(maskedIds: [String]) -> String? {
        if Thread.isMainThread {
            return captureSync(maskedIds: Set(maskedIds))
        }
        var result: String?
        DispatchQueue.main.sync {
            result = captureSync(maskedIds: Set(maskedIds))
        }
        return result
    }

    private static func captureSync(maskedIds: Set<String>) -> String? {
        guard let window = keyWindow() else { return nil }
        var nodes: [[String: Any]] = []
        walk(
            view: window,
            parentMasked: false,
            maskedIds: maskedIds,
            window: window,
            nodes: &nodes
        )
        let payload: [String: Any] = [
            "ts": Int(Date().timeIntervalSince1970 * 1000),
            "width": Double(window.bounds.width),
            "height": Double(window.bounds.height),
            "nodes": nodes,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: []) {
            return String(data: data, encoding: .utf8)
        }
        return nil
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
        return UIApplication.shared.windows.first
    }

    /// Cap on nodes per snapshot — extremely deep / wide trees can
    /// have thousands of subviews (UICollectionView recyclers).
    private static let MAX_NODES = 800

    private static func walk(
        view: UIView,
        parentMasked: Bool,
        maskedIds: Set<String>,
        window: UIWindow,
        nodes: inout [[String: Any]]
    ) {
        if nodes.count >= MAX_NODES { return }
        if view.isHidden || view.alpha < 0.01 { return }

        let isThisMasked = view.accessibilityIdentifier
            .map { maskedIds.contains($0) } ?? false
        let masked = parentMasked || isThisMasked

        let frame = view.convert(view.bounds, to: window)
        // Skip nodes outside the window bounds (off-screen recyclers).
        if !frame.intersects(window.bounds) {
            return
        }

        var node: [String: Any] = [
            "x": Double(frame.origin.x),
            "y": Double(frame.origin.y),
            "w": Double(frame.size.width),
            "h": Double(frame.size.height),
        ]

        if masked {
            node["kind"] = "mask"
        } else if let label = view as? UILabel, let text = label.text, !text.isEmpty {
            node["kind"] = "text"
            node["text"] = text.count > 200 ? String(text.prefix(200)) : text
            if let color = label.textColor.flatMap(colorToHex) {
                node["color"] = color
            }
        } else if let textView = view as? UITextView, let text = textView.text, !text.isEmpty {
            node["kind"] = "text"
            node["text"] = text.count > 200 ? String(text.prefix(200)) : text
        } else if view is UIImageView {
            node["kind"] = "image"
        } else if let bg = view.backgroundColor, let hex = colorToHex(bg), hex != "#00000000" {
            node["kind"] = "rect"
            node["color"] = hex
        }
        // else: invisible container — skip emitting but recurse.

        if node["kind"] != nil {
            nodes.append(node)
        }

        if !masked {
            // Don't expose internals of masked subtrees.
            for sub in view.subviews {
                walk(
                    view: sub,
                    parentMasked: masked,
                    maskedIds: maskedIds,
                    window: window,
                    nodes: &nodes
                )
            }
        }
    }

    private static func colorToHex(_ color: UIColor?) -> String? {
        guard let c = color else { return nil }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        let ri = max(0, min(255, Int(r * 255)))
        let gi = max(0, min(255, Int(g * 255)))
        let bi = max(0, min(255, Int(b * 255)))
        let ai = max(0, min(255, Int(a * 255)))
        return String(format: "#%02X%02X%02X%02X", ri, gi, bi, ai)
    }
}
