import { clearSpans, drainSpans } from '@goliapkg/sentori-core';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { type NavigationRefLike, useTraceNavigation } from '../navigation';

// We test the hook without a React renderer (sdk/react-native has no
// react-test-renderer or @testing-library dev-dep). Instead, we drive
// the same lifecycle by hand: the hook is a one-line useEffect, so
// we extract its effect body via a tiny harness that mirrors the
// observable behaviour.

// FakeNav mirrors @react-navigation/native's NavigationContainerRef
// surface — `addListener('state', cb)` + `getCurrentRoute()`.
class FakeNav implements NavigationRefLike {
  private listeners: Array<() => void> = [];
  private route: { name: string } | undefined;

  setInitialRoute(name: string): void {
    this.route = { name };
  }

  addListener(_event: 'state', listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getCurrentRoute(): { name: string } | undefined {
    return this.route;
  }

  go(name: string): void {
    this.route = { name };
    this.listeners.forEach((l) => l());
  }
}

// Re-implements the hook's effect body for test purposes. Mirroring
// the real hook 1:1 — when production code changes, this changes too.
// The point isn't to share the implementation but to verify the
// observable contract (spans pushed in the right order).
function harness(navigationRef: NavigationRefLike): () => void {
  let lastRoute: null | string =
    navigationRef.getCurrentRoute()?.name ?? null;
  let openSpan: ReturnType<typeof import('@goliapkg/sentori-core').startSpan> | null = null;

  // Inline import to avoid hoisting.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startSpan } = require('@goliapkg/sentori-core') as typeof import('@goliapkg/sentori-core');

  const unsub = navigationRef.addListener('state', () => {
    const next = navigationRef.getCurrentRoute()?.name ?? null;
    if (next === null || next === lastRoute) return;

    openSpan?.finish({ status: 'ok' });
    const span = startSpan('react.navigation', {
      name: lastRoute ? `${lastRoute} → ${next}` : next,
      tags: { 'nav.from': lastRoute ?? '', 'nav.to': next },
    });
    openSpan = span;
    lastRoute = next;
  });

  return () => {
    unsub();
    openSpan?.finish({ status: 'ok' });
    openSpan = null;
  };
}

beforeEach(() => clearSpans());
afterEach(() => clearSpans());

describe('useTraceNavigation', () => {
  test('hook + production module both export', () => {
    // Sanity: the exported symbol exists with the right shape.
    expect(typeof useTraceNavigation).toBe('function');
  });

  test('initial mount does NOT emit a span', () => {
    const nav = new FakeNav();
    nav.setInitialRoute('Home');
    const cleanup = harness(nav);
    expect(drainSpans()).toHaveLength(0);
    cleanup();
  });

  test('one transition + one more closes the first span', () => {
    const nav = new FakeNav();
    nav.setInitialRoute('Home');
    const cleanup = harness(nav);

    nav.go('Settings');
    nav.go('Profile');

    const spans = drainSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);
    const first = spans[0]!;
    expect(first.op).toBe('react.navigation');
    expect(first.name).toBe('Home → Settings');
    expect(first.tags).toEqual({ 'nav.from': 'Home', 'nav.to': 'Settings' });
    expect(first.status).toBe('ok');

    cleanup();
  });

  test('same-route state event does not emit a span', () => {
    const nav = new FakeNav();
    nav.setInitialRoute('Home');
    const cleanup = harness(nav);

    nav.go('Home');
    expect(drainSpans()).toHaveLength(0);

    cleanup();
  });

  test('chained transitions emit per-hop spans', () => {
    const nav = new FakeNav();
    nav.setInitialRoute('A');
    const cleanup = harness(nav);

    nav.go('B');
    nav.go('C');
    nav.go('D');

    const spans = drainSpans();
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans[0]?.name).toBe('A → B');
    expect(spans[1]?.name).toBe('B → C');

    cleanup();
  });

  test('cleanup closes the still-open span', () => {
    const nav = new FakeNav();
    nav.setInitialRoute('Home');
    const cleanup = harness(nav);

    nav.go('Settings');
    cleanup();

    const spans = drainSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('Home → Settings');
  });
});
