/**
 * Phase 45 sub-C — Svelte / SvelteKit adapter for Sentori.
 *
 * SvelteKit usage (preferred):
 *
 *     // hooks.client.ts
 *     import { initSentori } from '@goliapkg/sentori-svelte'
 *     initSentori({ token: 'st_pk_...', release: 'myapp@1.0.0' })
 *
 *     export const handleError = sentoriHandleError()
 *
 * What you get:
 *   - `initSentori(opts)` — thin wrapper over the JS SDK init
 *   - `sentoriHandleError()` — returns a SvelteKit `HandleClientError`
 *     hook that captures into Sentori then returns the original
 *     error metadata so SvelteKit's own error page still renders
 *   - `traceNavigation(navigating)` — feed `$navigating` from
 *     `$app/stores` and we open / finish `svelte.navigation` spans
 *     per route transition (one trace per screen, same shape as
 *     the Vue + RN adapters)
 *
 * Vanilla Svelte (no SvelteKit) — call `initSentori` from your app
 * root + use the `<svelte:boundary>` element (Svelte 5+) or
 * `onError` prop on your top-level component.
 */

import {
  captureException as captureExceptionJs,
  initSentori as initSentoriJs,
  type InitOptions,
} from '@goliapkg/sentori-javascript'
import { setActiveSpan, startSpan, type SpanHandle } from '@goliapkg/sentori-core'

export type SentoriSvelteOptions = InitOptions

export function initSentori(options: SentoriSvelteOptions): void {
  initSentoriJs(options)
}

/**
 * SvelteKit `handleError` hook factory. Returns a function with the
 * `HandleClientError` shape (parameters typed loosely so we don't
 * need to import SvelteKit's `@sveltejs/kit` types and force a
 * peer dep).
 */
export function sentoriHandleError(): (input: {
  error: unknown
  event?: unknown
  status?: number
  message?: string
}) => { message: string } {
  return ({ error, message }) => {
    const e = error instanceof Error ? error : new Error(String(error))
    captureExceptionJs(e)
    return { message: message ?? e.message }
  }
}

/**
 * Trace page navigation. Pass SvelteKit's `$navigating` store value
 * — when it transitions from null → some route, we open a span;
 * when it transitions back to null, we finish it.
 *
 *     // +layout.svelte
 *     import { traceNavigation } from '@goliapkg/sentori-svelte'
 *     import { navigating } from '$app/stores'
 *     $: traceNavigation($navigating)
 */
let _active: SpanHandle | null = null
type NavigatingLike = null | { from?: { url: { pathname: string } }; to?: { url: { pathname: string } } }
export function traceNavigation(navigating: NavigatingLike): void {
  if (navigating) {
    if (_active) {
      _active.finish({ status: 'ok' })
      _active = null
    }
    const from = navigating.from?.url.pathname ?? '/'
    const to = navigating.to?.url.pathname ?? '/'
    const span = startSpan('svelte.navigation', {
      name: `${from} → ${to}`,
      parent: null,
      tags: { 'nav.from': from, 'nav.to': to },
    })
    _active = span
    setActiveSpan(span)
  } else if (_active) {
    _active.finish({ status: 'ok' })
    _active = null
  }
}

export {
  addBreadcrumb,
  captureException,
  captureException as captureError,
  getUser,
  setUser,
} from '@goliapkg/sentori-javascript'
