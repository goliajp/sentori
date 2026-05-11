// Phase 35 sub-C: react-navigation auto-instrumentation.
//
// Mount `useTraceNavigation(navigationRef)` next to your
// `<NavigationContainer ref={navigationRef}>` and every route
// transition becomes a `react.navigation` span. Span names are
// `<from> → <to>` so the trace list reads as a navigation log.
//
// react-navigation is an OPTIONAL peer dependency — apps that
// don't use it never have to install it. The hook itself doesn't
// import from @react-navigation/native; consumers pass in the ref
// they already have, and we read its state via the public
// `getCurrentRoute()` API. That keeps the dep edge optional.

import { useEffect, useRef } from 'react';

import { startSpan, type SpanHandle } from '@goliapkg/sentori-core';

/** Minimal contract: anything with `addListener('state', cb)` and
 *  `getCurrentRoute()` works. The real @react-navigation/native
 *  NavigationContainer ref matches this shape. */
export type NavigationRefLike = {
  addListener: (event: 'state', listener: () => void) => () => void;
  getCurrentRoute: () => { name: string } | undefined;
};

/**
 * Subscribe to react-navigation state changes and emit a
 * `react.navigation` span per transition. First mount records the
 * initial route as the start anchor but does NOT emit a span (the
 * convention from `useSentoriRouter` in sentori-react).
 *
 *     import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native'
 *     import { useTraceNavigation } from '@goliapkg/sentori-react-native'
 *
 *     function App() {
 *       const navigationRef = useNavigationContainerRef()
 *       useTraceNavigation(navigationRef)
 *       return <NavigationContainer ref={navigationRef}>{...}</NavigationContainer>
 *     }
 *
 * Each span carries `{ from, to }` as tags and uses the destination
 * route name as the span name.
 */
export function useTraceNavigation(navigationRef: NavigationRefLike): void {
  // Latest route name we've observed. `null` means "no transition
  // recorded yet" (initial mount).
  const lastRouteRef = useRef<null | string>(null);
  // Span that started when this route was entered. Finished when the
  // NEXT route transition arrives.
  const openSpanRef = useRef<null | SpanHandle>(null);

  useEffect(() => {
    if (typeof navigationRef.addListener !== 'function') return;
    if (typeof navigationRef.getCurrentRoute !== 'function') return;

    // Seed the "last route" reference from the current state so the
    // first transition emits a span with the right `from`.
    const initial = navigationRef.getCurrentRoute()?.name ?? null;
    lastRouteRef.current = initial;

    const unsubscribe = navigationRef.addListener('state', () => {
      const next = navigationRef.getCurrentRoute()?.name ?? null;
      const prev = lastRouteRef.current;
      if (next === null || next === prev) return;

      // Close the prior span (if any) before opening the new one so
      // the trace looks like a sequence, not nested.
      openSpanRef.current?.finish({ status: 'ok' });

      const span = startSpan('react.navigation', {
        name: prev ? `${prev} → ${next}` : next,
        tags: { 'nav.from': prev ?? '', 'nav.to': next },
      });
      openSpanRef.current = span;
      lastRouteRef.current = next;
    });

    return () => {
      unsubscribe();
      // Close any still-open span on unmount so we don't leak it.
      openSpanRef.current?.finish({ status: 'ok' });
      openSpanRef.current = null;
    };
  }, [navigationRef]);
}
