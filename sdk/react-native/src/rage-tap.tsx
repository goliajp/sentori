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

import { pushSignal, snapshotSignals } from '@goliapkg/sentori-core';

import { getConfig } from './config';
import { currentScreen } from './navigation';
import { RAGE_THRESHOLD, RAGE_WINDOW_MS, recordTap } from './rage-tap-detector';
import {
  RESPONSE_WINDOW_MS,
  SLUGGISH_MS,
  classifyTap,
  recordDeadTap,
  recordSluggish,
} from './responsiveness-detector';
import { warnDetected } from './verbs';

export function RageTapCapture({
  children,
  ...rest
}: ViewProps & { children?: React.ReactNode }): React.JSX.Element {
  const recent = useRef<Map<number, number[]>>(new Map());
  const deadBuckets = useRef<Map<number, number[]>>(new Map());
  const sluggishWarns = useRef<Map<number, number>>(new Map());

  const onTouchEnd = useCallback((e: GestureResponderEvent) => {
    try {
      const target = e.nativeEvent?.target;
      if (typeof target !== 'number') return;
      const tapAt = Date.now();
      pushSignal('tap', { target });

      // Responsiveness verdict lands after the window closes: the
      // ring tells us whether the app reacted to this tap at all.
      setTimeout(() => {
        try {
          const screen = currentScreen();
          // Ring snapshots carry event-relative seconds (one decimal);
          // rebase them onto the epoch for the classifier.
          const nowMs = Date.now();
          const times = snapshotSignals(nowMs)
            .filter((s) => s.kind !== 'tap')
            .map((s) => nowMs + s.t * 1000);
          const outcome = classifyTap(tapAt, times);
          if (outcome === 'dead' && recordDeadTap(deadBuckets.current, target, Date.now())) {
            warnDetected(
              'dead_button',
              { screen, element: String(target) },
              { windowMs: RESPONSE_WINDOW_MS },
            );
          } else if (
            outcome === 'sluggish' &&
            recordSluggish(sluggishWarns.current, target, Date.now())
          ) {
            warnDetected(
              'sluggish_button',
              { screen, element: String(target) },
              { thresholdMs: SLUGGISH_MS },
            );
          }
        } catch {
          // detector bug must never surface
        }
      }, RESPONSE_WINDOW_MS + 50);

      if (!recordTap(recent.current, target, tapAt)) return;
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
