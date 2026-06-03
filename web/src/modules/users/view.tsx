import { useState } from 'react'

import { PageHeader } from '@/layout/page-header'

import { UsersErase } from './erase'
import { UsersLookup } from './lookup'
import { UsersMerge } from './merge'
import { UsersOverview } from './overview'

function hasLookupDeepLink(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const hash = params.get('hash')
  return !!hash && /^[a-f0-9]{64}$/.test(hash)
}

/**
 * v2.4 — Users module shell.
 *
 * Default view is the overview (KPI band + most-affected
 * fingerprints + per-release / per-key-type breakdown) loaded over
 * the org's default identity scope. The cross-project lookup form
 * (v2.3) lives in a collapsible "lookup by identity" bar at the top.
 *
 * Deep-link rule: if the URL already carries a `?hash=…&type=…` (an
 * existing share link or a back-navigation), the lookup bar opens
 * itself so the operator lands directly on the result.
 */
export function UsersView() {
  const [lookupOpen, setLookupOpen] = useState(() => hasLookupDeepLink())
  // v2.3 — DSR erase bar. Off by default since it's a destructive
  // op, but a single click opens the inline form. No deep-link
  // analogue: erase requires a typed-confirmation gate every time;
  // we deliberately don't let a URL preload the dangerous state.
  const [eraseOpen, setEraseOpen] = useState(false)
  // v2.4 — operator-driven identity merge bar. Reversible (soft
  // undo within 7 days) so we don't typed-confirmation-gate it
  // like erase. Off by default — merges are rare + intentional.
  const [mergeOpen, setMergeOpen] = useState(false)

  return (
    <div className="sentori-page-in">
      <PageHeader
        subtitle="identified fingerprints · raw values never leave your browser"
        title="Users"
      />

      <div className="mb-2">
        <button
          aria-expanded={lookupOpen}
          className="flex w-full items-center gap-2 border-y border-[color:var(--rule)] py-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--ink-soft)]"
          onClick={() => setLookupOpen((v) => !v)}
          type="button"
        >
          <span aria-hidden>{lookupOpen ? '▾' : '▸'}</span>
          <span>lookup by identity</span>
        </button>
        {lookupOpen && (
          <div className="mt-2">
            <UsersLookup />
          </div>
        )}
      </div>

      <div className="mb-2">
        <button
          aria-expanded={mergeOpen}
          className="flex w-full items-center gap-2 border-y border-[color:var(--rule)] py-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--ink-soft)]"
          onClick={() => setMergeOpen((v) => !v)}
          type="button"
        >
          <span aria-hidden>{mergeOpen ? '▾' : '▸'}</span>
          <span>merge identities</span>
        </button>
        {mergeOpen && (
          <div className="mt-2">
            <UsersMerge />
          </div>
        )}
      </div>

      <div className="mb-6">
        <button
          aria-expanded={eraseOpen}
          className="flex w-full items-center gap-2 border-y border-[color:var(--rule)] py-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--danger)]"
          onClick={() => setEraseOpen((v) => !v)}
          type="button"
        >
          <span aria-hidden>{eraseOpen ? '▾' : '▸'}</span>
          <span>erase identity (DSR)</span>
        </button>
        {eraseOpen && (
          <div className="mt-2">
            <UsersErase />
          </div>
        )}
      </div>

      <UsersOverview />
    </div>
  )
}
