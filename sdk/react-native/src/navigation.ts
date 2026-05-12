// Phase 35 sub-C: react-navigation auto-instrumentation.
// Phase 39 sub-B: the open `react.navigation` span is also made the
// active span for that screen's lifetime, so the screen's
// `http.client` spans (and any other startSpan() calls) attach to it
// as children — one trace per screen instead of one per request.
//
// Mount `useTraceNavigation(navigationRef)` next to your
// `<NavigationContainer ref={navigationRef}>`. Span names are
// `<from> → <to>` (or just the route name for the first screen) so
// the trace list reads as a navigation log.
//
// react-navigation is an OPTIONAL peer dependency — apps that don't
// use it never have to install it. The hook doesn't import from
// @react-navigation/native; consumers pass in the ref they already
// have, and we read its state via the public `getCurrentRoute()`.
//
// Caveat (active-span on RN is a module variable): requests fired
// from a `setTimeout` / background poll / detached promise after the
// screen settled may not see the nav span as active. If you want such
// a request parented to the current screen, pass it explicitly:
// `startSpan(op, { parent: activeSpan() })`.

import { useEffect, useRef } from 'react';

import { setActiveSpan, startSpan, type SpanHandle } from '@goliapkg/sentori-core';

/** Minimal contract: anything with `addListener('state', cb)` and
 *  `getCurrentRoute()` works. The real @react-navigation/native
 *  NavigationContainer ref matches this shape. */
export type NavigationRefLike = {
  addListener: (event: 'state', listener: () => void) => () => void;
  getCurrentRoute: () => { name: string } | undefined;
};

/**
 * Subscribe to react-navigation state changes and emit a
 * `react.navigation` span per screen (including the initial one),
 * each a fresh trace root. The span is kept active while the screen
 * is current; child spans created in that window attribute up to it.
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
 * Each span carries `{ nav.from, nav.to }` tags.
 */
export function useTraceNavigation(navigationRef: NavigationRefLike): void {
  // Latest route name we've observed.
  const lastRouteRef = useRef<null | string>(null);
  // Span for the screen the user is currently on. Finished when the
  // next screen is entered (or on unmount).
  const openSpanRef = useRef<null | SpanHandle>(null);

  useEffect(() => {
    if (typeof navigationRef.addListener !== 'function') return;
    if (typeof navigationRef.getCurrentRoute !== 'function') return;

    // Each screen gets its own trace root — detach from whatever the
    // previous screen's span was (we keep it active, so without
    // `parent: null` the new one would nest under it).
    const openScreenSpan = (from: null | string, to: string) => {
      const span = startSpan('react.navigation', {
        name: from ? `${from} → ${to}` : to,
        parent: null,
        tags: { 'nav.from': from ?? '', 'nav.to': to },
      });
      openSpanRef.current = span;
      setActiveSpan(span);
      lastRouteRef.current = to;
    };

    // Open a span for the initial screen so its requests are grouped
    // too (auth / config / first data load are usually the busiest
    // screen of a session).
    const initial = navigationRef.getCurrentRoute()?.name ?? null;
    if (initial !== null) openScreenSpan(null, initial);
    else lastRouteRef.current = null;

    const unsubscribe = navigationRef.addListener('state', () => {
      const next = navigationRef.getCurrentRoute()?.name ?? null;
      const prev = lastRouteRef.current;
      if (next === null || next === prev) return;
      openSpanRef.current?.finish({ status: 'ok' });
      openScreenSpan(prev, next);
    });

    return () => {
      unsubscribe();
      openSpanRef.current?.finish({ status: 'ok' });
      openSpanRef.current = null;
      setActiveSpan(null);
    };
  }, [navigationRef]);
}
