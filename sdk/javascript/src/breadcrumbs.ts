import type { Breadcrumb, BreadcrumbType } from './types.js'

const MAX = 100
const buf: Breadcrumb[] = []

export type AddBreadcrumbInput = {
  data?: Record<string, unknown>
  type: BreadcrumbType
}

export function addBreadcrumb(input: AddBreadcrumbInput): void {
  const crumb: Breadcrumb = {
    data: input.data ?? {},
    timestamp: new Date().toISOString(),
    type: input.type,
  }
  buf.push(crumb)
  if (buf.length > MAX) buf.shift()
}

export function getBreadcrumbs(): Breadcrumb[] {
  return [...buf]
}

export function clearBreadcrumbs(): void {
  buf.length = 0
}
