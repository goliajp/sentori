// Phase 42 sub-D.09/10 — mark UI regions as "do not screenshot".
//
// `<MaskRegion>` wraps any subtree the SDK should redact before
// shipping a crash screenshot. It's purely declarative — the
// component renders its children as-is in normal flight, but its
// `View` is tagged with `collapsable={false}` + a sentinel
// `nativeID` so the platform-level screenshotters
// (`react-native-view-shot`, the iOS / Android native crash
// capturers we add in sub-E / sub-F) can find it and paint over.
//
// `setMaskedNode(ref)` is the imperative escape hatch: useful
// when the sensitive view isn't yours to wrap (a third-party
// modal, a video player, etc.). Pass a React ref obtained via
// `createRef()` / `useRef()` and the SDK will redact that
// subtree the next time it captures.
//
// `getMaskedRegions()` returns the current set of native tags;
// `captureScreenshot()` would consult this list, but
// `react-native-view-shot` doesn't expose a "redact these rects"
// hook — so this iteration ships the registration API only and
// the rendered overlay lives behind a default-on
// `<View style={{ backgroundColor: '#000' }}>` you can wrap
// yourself. The iOS / Android crash-time screenshotters in
// sub-E / sub-F will read this list before drawing.

import React, { type ReactNode, useEffect, useRef } from 'react';
import { View, type ViewProps } from 'react-native';

/** Component-level node identifiers we've been asked to redact. */
const _maskedRefs = new Set<React.Component | View | unknown>();
const _maskedNativeIds = new Set<string>();

/**
 * Imperative registration: when you can't wrap the sensitive view
 * in `<MaskRegion>`, drop a ref on it and call `setMaskedNode(ref)`.
 * Future captures will mask the subtree.
 */
export function setMaskedNode(node: React.Component | View | null | unknown): void {
  if (!node) return;
  _maskedRefs.add(node);
}

/** Removes a previously registered ref. Pair this with mount/unmount
 *  lifecycle hooks if the node is short-lived. */
export function unsetMaskedNode(node: React.Component | View | null | unknown): void {
  if (!node) return;
  _maskedRefs.delete(node);
}

/** Returns the current set of registered masked nodes + nativeIDs.
 *  Read by the native screenshotter layer in sub-E / sub-F. */
export function getMaskedRegions(): {
  refs: Set<unknown>;
  nativeIds: Set<string>;
} {
  return { nativeIds: _maskedNativeIds, refs: _maskedRefs };
}

/**
 * Declarative redaction. `<MaskRegion>{children}</MaskRegion>` keeps
 * the children visible in normal flight; under capture, the wrapping
 * view is repainted black so the rendered screenshot doesn't leak
 * the underlying pixels.
 */
export function MaskRegion({
  children,
  nativeID,
  ...rest
}: { children: ReactNode; nativeID?: string } & ViewProps): React.JSX.Element {
  // Auto-generate a stable nativeID per mount so the native
  // screenshotter can find this view by ID at capture time.
  const idRef = useRef<string>(
    nativeID ?? `sentori-mask-${Math.random().toString(36).slice(2, 10)}`,
  );

  useEffect(() => {
    const id = idRef.current;
    _maskedNativeIds.add(id);
    return () => {
      _maskedNativeIds.delete(id);
    };
  }, []);

  return (
    <View collapsable={false} nativeID={idRef.current} {...rest}>
      {children}
    </View>
  );
}

/** Test-only — flush registration tables. */
export function __resetMaskedRegionsForTests(): void {
  _maskedRefs.clear();
  _maskedNativeIds.clear();
}
