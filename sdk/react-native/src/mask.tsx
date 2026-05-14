// Phase 42 sub-D.09/10 + Phase 48 sub-B — mark UI regions as "do not
// screenshot" AND actually redact them at capture time.
//
// `<MaskRegion>` renders its children normally, plus a black overlay
// `<View>` that sits on top of them with `opacity: 0`. Right before
// `captureScreenshot()` calls into react-native-view-shot, the SDK
// flips every registered overlay to `opacity: 1` (black square covers
// the children), captures, then flips back to `opacity: 0` so the
// user never sees the overlay. The overlay uses `pointerEvents="none"`
// so it never intercepts touches.
//
// `setMaskedNode(ref)` is the imperative escape hatch for views you
// can't wrap. We can't inject an overlay into a foreign view, so the
// imperative path falls back to setting the registered view's own
// `opacity: 0` for the capture window — content underneath may show
// through, but that beats sending the sensitive content to the server.
// Prefer `<MaskRegion>` when you control the subtree.

import React, { type ReactNode, useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

/** What we drive in the capture window: any handle with
 *  `setNativeProps({ opacity })`. RN's View instance satisfies this. */
type Maskable = {
  setNativeProps?: (props: { style?: { opacity?: number } }) => void;
};

const _maskedRefs = new Set<Maskable>();
const _maskedOverlays = new Set<Maskable>();
const _maskedNativeIds = new Set<string>();

/**
 * Imperative registration: pass a ref obtained via `useRef()` /
 * `createRef()` to a `<View>` you want hidden from screenshots.
 */
export function setMaskedNode(node: null | Maskable | unknown): void {
  if (!node || typeof (node as Maskable).setNativeProps !== 'function') return;
  _maskedRefs.add(node as Maskable);
}

export function unsetMaskedNode(node: null | Maskable | unknown): void {
  if (!node) return;
  _maskedRefs.delete(node as Maskable);
}

/** Returns the current set of registered masked nodes + nativeIDs.
 *  Read by the native screenshotter layer (iOS / Android sub-E / F). */
export function getMaskedRegions(): {
  nativeIds: Set<string>;
  overlays: Set<Maskable>;
  refs: Set<Maskable>;
} {
  return { nativeIds: _maskedNativeIds, overlays: _maskedOverlays, refs: _maskedRefs };
}

/**
 * Phase 48 sub-B — engage masking right before screenshot capture.
 * Returns a function the caller must invoke once capture is done so
 * the user never sees the black overlays.
 *
 * Two paths:
 *   - Overlays from `<MaskRegion>`: flip opacity 0 → 1 (cover children).
 *   - Imperative refs from `setMaskedNode`: flip opacity 1 → 0 on the
 *     view itself (whole subtree disappears for one frame).
 *
 * All `setNativeProps` calls are best-effort — a failure on one
 * doesn't block the others or the capture.
 */
export function engageMasks(): () => void {
  const overlaysEngaged: Maskable[] = [];
  for (const o of _maskedOverlays) {
    try {
      o.setNativeProps?.({ style: { opacity: 1 } });
      overlaysEngaged.push(o);
    } catch {
      // skip
    }
  }
  const refsEngaged: Maskable[] = [];
  for (const r of _maskedRefs) {
    try {
      r.setNativeProps?.({ style: { opacity: 0 } });
      refsEngaged.push(r);
    } catch {
      // skip
    }
  }
  return () => {
    for (const o of overlaysEngaged) {
      try {
        o.setNativeProps?.({ style: { opacity: 0 } });
      } catch {
        // skip
      }
    }
    for (const r of refsEngaged) {
      try {
        r.setNativeProps?.({ style: { opacity: 1 } });
      } catch {
        // skip
      }
    }
  };
}

/**
 * Declarative redaction. `<MaskRegion>{children}</MaskRegion>` keeps
 * the children visible in normal flight; under capture the overlay's
 * opacity is flipped to 1 and the children are hidden behind a black
 * square in the rendered screenshot.
 */
export function MaskRegion({
  children,
  nativeID,
  ...rest
}: { children: ReactNode; nativeID?: string } & ViewProps): React.JSX.Element {
  const idRef = useRef<string>(
    nativeID ?? `sentori-mask-${Math.random().toString(36).slice(2, 10)}`,
  );
  const overlayRef = useRef<null | View>(null);

  useEffect(() => {
    const id = idRef.current;
    _maskedNativeIds.add(id);
    const overlay = overlayRef.current as null | Maskable;
    if (overlay) _maskedOverlays.add(overlay);
    return () => {
      _maskedNativeIds.delete(id);
      if (overlay) _maskedOverlays.delete(overlay);
    };
  }, []);

  return (
    <View collapsable={false} nativeID={idRef.current} {...rest}>
      {children}
      <View
        pointerEvents="none"
        ref={overlayRef}
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0 }]}
      />
    </View>
  );
}

/** Test-only — flush registration tables. */
export function __resetMaskedRegionsForTests(): void {
  _maskedRefs.clear();
  _maskedOverlays.clear();
  _maskedNativeIds.clear();
}
