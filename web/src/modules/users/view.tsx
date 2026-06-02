import { useState } from 'react'

import { PageHeader } from '@/layout/page-header'

import { UsersLookup } from './lookup'
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

  return (
    <div className="sentori-page-in">
      <PageHeader
        subtitle="identified fingerprints · raw values never leave your browser"
        title="Users"
      />

      <div className="mb-6">
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

      <UsersOverview />
    </div>
  )
}
