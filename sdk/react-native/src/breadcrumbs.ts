// Phase 21: ring buffer logic lives in @goliapkg/sentori-core. The
// public surface here keeps its object-form `addBreadcrumb({ type,
// data, timestamp? })` so existing callers don't break, and we
// expose `__resetForTests` for the test suite.
import {
  BreadcrumbBuffer,
  clearBreadcrumbs as clearCore,
  getBreadcrumbs as getCore,
  addBreadcrumb as pushCore,
} from '@goliapkg/sentori-core'

import type { Breadcrumb, BreadcrumbType } from './types'

export type AddBreadcrumbInput = {
  data: Record<string, unknown>
  timestamp?: string
  type: BreadcrumbType
}

const _shadow = new BreadcrumbBuffer()

export const addBreadcrumb = (input: AddBreadcrumbInput): void => {
  if (input.timestamp) {
    // Caller wants a specific timestamp — pushCore stamps `now()`, so
    // we go through a private buffer to preserve that field. This path
    // is rarely used (most callers omit timestamp).
    _shadow.push(input.type, input.data)
    const last = _shadow.snapshot().at(-1)
    if (last) last.timestamp = input.timestamp
    return
  }
  pushCore(input.type, input.data)
}

export const getBreadcrumbs = (): Breadcrumb[] => getCore()

export const clearBreadcrumbs = (): void => {
  clearCore()
  _shadow.clear()
}

export const __resetForTests = (): void => clearBreadcrumbs()
