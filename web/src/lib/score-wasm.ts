// v1.1 — Rust → WebAssembly trust-score kernel.
//
// Mirrors `server/src/api/trust_score.rs::score_from_counts`. The
// signal-explorer slider in the Posture > Trust tab uses this so
// operator changes to per-kind weights produce a re-score within
// the browser without a server round-trip.
//
// Loader is lazy + singleton: the .wasm is fetched once on first
// use, instantiated, and cached. Source crate at
// `wasm/score/`. Pre-built artefact at `web/public/wasm/`.

type ScoreModule = {
  maxKinds: number
  reset: () => void
  score: (rows: { count: number; weight: number }[]) => number
}

let _module: null | ScoreModule = null
let _inflight: null | Promise<ScoreModule> = null

async function load(): Promise<ScoreModule> {
  if (_module) return _module
  if (_inflight) return _inflight
  _inflight = (async () => {
    const resp = await fetch('/wasm/sentori_score.wasm')
    if (!resp.ok) throw new Error(`wasm fetch ${resp.status}`)
    const buf = await resp.arrayBuffer()
    const { instance } = await WebAssembly.instantiate(buf, {})
    const exports = instance.exports as unknown as {
      max_kinds: () => number
      reset: () => void
      score: (len: number) => number
      set_pair: (idx: number, weight: number, count: number) => void
    }
    const max = exports.max_kinds()
    _module = {
      maxKinds: max,
      reset: () => exports.reset(),
      score: (rows) => {
        const len = Math.min(rows.length, max)
        exports.reset()
        for (let i = 0; i < len; i += 1) {
          const r = rows[i]!
          exports.set_pair(i, r.weight | 0, r.count | 0)
        }
        return exports.score(len)
      },
    }
    return _module
  })().finally(() => {
    _inflight = null
  })
  return _inflight
}

/** Resolve the score kernel; subsequent calls are sync via the
 *  cached module. */
export async function getScoreKernel(): Promise<ScoreModule> {
  return load()
}

/** Sync access to the cached kernel. `null` before the first
 *  `getScoreKernel()` resolves. */
export function peekScoreKernel(): null | ScoreModule {
  return _module
}
