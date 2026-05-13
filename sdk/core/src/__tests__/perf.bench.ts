/**
 * Phase 47.04 — perf-budget gate for the SDK's hot paths.
 *
 * Not a unit test — we assert that each hot operation stays under a
 * fixed wall-clock budget so the SDK can't regress in a future PR
 * without a visible test failure. Budgets are intentionally generous
 * (10x the typical observed time) to keep the gate stable on a
 * shared CI runner; if any of these *fails* we have a real regression.
 *
 * Run with:
 *     bun test src/__tests__/perf.bench.ts
 */

import { describe, expect, test } from 'bun:test'

import { addBreadcrumb, clearBreadcrumbs, getBreadcrumbs } from '../breadcrumbs.js'
import { shouldSample, shouldSampleTrace } from '../sampling.js'
import { TrailBuffer, sealTrail } from '../trail.js'
import { uuidV7 } from '../uuid.js'

function timed(label: string, loops: number, fn: () => void): number {
  // Warm-up — eject any first-call JIT cost from the measurement.
  for (let i = 0; i < Math.min(loops, 1000); i++) fn()
  const start = performance.now()
  for (let i = 0; i < loops; i++) fn()
  const total = performance.now() - start
  // Per-op µs.
  const perOp = (total * 1000) / loops
  // eslint-disable-next-line no-console
  console.log(`bench: ${label} ${perOp.toFixed(2)} µs/op (${loops} loops)`)
  return perOp
}

describe('SDK perf budget', () => {
  test('uuidV7 < 5 µs/op', () => {
    const perOp = timed('uuidV7', 50_000, () => {
      uuidV7()
    })
    expect(perOp).toBeLessThan(5)
  })

  test('shouldSample(rate) < 1 µs/op', () => {
    const perOp = timed('shouldSample', 100_000, () => {
      shouldSample(0.5)
    })
    expect(perOp).toBeLessThan(1)
  })

  test('shouldSampleTrace(traceId, rate) < 5 µs/op', () => {
    const id = '019eaa00000070008000000000000001'
    const perOp = timed('shouldSampleTrace', 100_000, () => {
      shouldSampleTrace(id, 0.5)
    })
    expect(perOp).toBeLessThan(5)
  })

  test('addBreadcrumb + getBreadcrumbs round-trip < 10 µs/op', () => {
    clearBreadcrumbs()
    const perOp = timed('breadcrumb round-trip', 20_000, () => {
      addBreadcrumb('custom', { x: 1 })
      getBreadcrumbs()
    })
    expect(perOp).toBeLessThan(10)
  })

  test('TrailBuffer.push (eviction path) < 1 µs/op', () => {
    const buf = new TrailBuffer(30)
    const perOp = timed('TrailBuffer.push', 50_000, () => {
      buf.push({ label: 'step', ts: Date.now() })
    })
    expect(perOp).toBeLessThan(1)
  })

  test('sealTrail(buffer) < 50 µs', () => {
    const buf = new TrailBuffer(30)
    for (let i = 0; i < 30; i++) buf.push({ label: `step-${i}`, ts: i })
    // sealTrail allocates — measured separately as one-shot wall time.
    const perOp = timed('sealTrail', 5_000, () => {
      sealTrail(buf)
    })
    expect(perOp).toBeLessThan(50)
  })
})
