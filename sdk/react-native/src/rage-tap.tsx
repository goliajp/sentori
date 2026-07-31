// rage_tap — the first detected warn scenario (design.md §3,
// category A: 「我按了没反应/反复按」).
//
// Wrap the app root (next to ErrorBoundary) with
// `<RageTapCapture>{children}</RageTapCapture>`. Bubble-phase
// `onTouchEnd` only — pure observation, no gesture interference.
//
// Mini-spec: ≥3 taps on the same native target within 800 ms ⇒ one
// `warn` event, scenario `rage_tap`, surface = current screen +
// target id, plus a signal-ring entry. Per-target cooldown resets
// after firing so a frustrated 10-tap burst is one event, not four.

import React, { useCallback, useRef } from 'react';
import { View, type GestureResponderEvent, type ViewProps } from 'react-native';

import { pushSignal } from '@goliapkg/sentori-core';

import { getConfig } from './config';
import { currentScreen } from './navigation';
import { RAGE_THRESHOLD, RAGE_WINDOW_MS, recordTap } from './rage-tap-detector';
import { warnDetected } from './verbs';

export function RageTapCapture({
  children,
  ...rest
}: ViewProps & { children?: React.ReactNode }): React.JSX.Element {
  const recent = useRef<Map<number, number[]>>(new Map());

  const onTouchEnd = useCallback((e: GestureResponderEvent) => {
    try {
      const target = e.nativeEvent?.target;
      if (typeof target !== 'number') return;
      pushSignal('tap', { target });
      if (!recordTap(recent.current, target, Date.now())) return;
      if (getConfig()?.detect.rageTap === false) return;
      warnDetected(
        'rage_tap',
        { screen: currentScreen(), element: String(target) },
        { taps: RAGE_THRESHOLD, windowMs: RAGE_WINDOW_MS },
      );
    } catch {
      // A detector bug must never reach the host's touch pipeline.
    }
  }, []);

  return (
    <View {...rest} onTouchEnd={onTouchEnd}>
      {children}
    </View>
  );
}
