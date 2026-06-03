import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { type IdentityMergeResp, orgsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { hashIdentity, type IdentityKeyType } from '@/lib/identity-hash'

/**
 * v2.4 — operator-driven identity merge form.
 *
 * Story: the same human registered in your app via Google in
 * January then via email in March. Sentori's two fingerprints
 * for them are correct (different `linkBy` keys) but
 * operationally the operator wants them collapsed for the Users
 * dashboard.
 *
 * UX flow (same privacy contract as lookup + erase):
 *
 *   1. Operator picks two `(keyType, raw value)` pairs — "primary"
 *      and "alias".
 *   2. Browser hashes each via `crypto.subtle.digest` before they
 *      leave the page. Raw values are wiped from React state the
 *      instant the hashes are computed.
 *   3. Form POSTs to /users/merge. Server resolves the org's
 *      default scope, computes the salted fingerprints, writes
 *      one row in identity_merges. Audit log entry per call.
 *   4. Future /users/lookup calls against the alias hash
 *      transparently return the primary's events (one-hop follow).
 *
 * Soft-undo: 7-day window in the dashboard. The undo button
 * stays available on the success row for that long, then
 * collapses to "merge history" view. Server has no time gate —
 * it's purely a UI affordance.
 */

const KEY_TYPES: { label: string; value: IdentityKeyType }[] = [
  { label: 'Email', value: 'email' },
  { label: 'Phone', value: 'phone' },
  { label: 'Google Sub', value: 'googleSub' },
  { label: 'Apple Sub', value: 'appleSub' },
  { label: 'Username', value: 'username' },
]

export function UsersMerge() {
  const { currentOrg } = useOrg()
  const [primaryType, setPrimaryType] = useState<IdentityKeyType>('email')
  const [primaryRaw, setPrimaryRaw] = useState('')
  const [aliasType, setAliasType] = useState<IdentityKeyType>('googleSub')
  const [aliasRaw, setAliasRaw] = useState('')
  const [submitError, setSubmitError] = useState<null | string>(null)

  const mergeM = useMutation<
    IdentityMergeResp,
    Error,
    {
      primary: { keyType: string; clientHash: string }
      alias: { keyType: string; clientHash: string }
    }
  >({
    mutationFn: (body) => orgsApi.usersMerge(currentOrg.slug, body),
  })
  const undoM = useMutation<{ undone: boolean }, Error, { keyType: string; clientHash: string }>({
    mutationFn: (alias) => orgsApi.usersMergeUndo(currentOrg.slug, { alias }),
  })

  // Persist the alias hash from the last successful merge so the
  // "undo" button has something to POST. Wiped when the operator
  // starts a new merge.
  const [lastAlias, setLastAlias] = useState<null | { keyType: string; clientHash: string }>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    const p = primaryRaw.trim()
    const a = aliasRaw.trim()
    if (p === '' || a === '') {
      setSubmitError('Enter both primary and alias values.')
      return
    }
    try {
      const primaryHash = await hashIdentity(primaryType, p)
      const aliasHash = await hashIdentity(aliasType, a)
      // Privacy: wipe raw inputs the moment hashes are in hand.
      setPrimaryRaw('')
      setAliasRaw('')
      const aliasRef = { clientHash: aliasHash, keyType: aliasType }
      setLastAlias(aliasRef)
      undoM.reset()
      mergeM.mutate({
        primary: { clientHash: primaryHash, keyType: primaryType },
        alias: aliasRef,
      })
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Hashing failed; your browser may not support SubtleCrypto.'
      )
    }
  }

  const onUndo = () => {
    if (!lastAlias) return
    undoM.mutate(lastAlias)
  }

  const result = mergeM.data
  const undone = undoM.data?.undone === true

  return (
    <div>
      <form className="border-border border-y py-4" onSubmit={onSubmit}>
        <div className="space-y-3">
          {/* Primary row */}
          <div className="grid grid-cols-[80px_140px_1fr] items-end gap-3">
            <span className="text-accent block self-center font-mono text-[10px] tracking-[0.18em] uppercase">
              primary
            </span>
            <select
              aria-label="primary identity type"
              className="border-border bg-bg-secondary text-fg focus:border-accent h-8 w-full border px-2 font-mono text-[12px] focus:outline-none"
              onChange={(e) => setPrimaryType(e.target.value as IdentityKeyType)}
              value={primaryType}
            >
              {KEY_TYPES.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              aria-label="primary value (hashed before send)"
              autoComplete="off"
              className="border-border bg-bg-secondary text-fg focus:border-accent h-8 w-full border px-2 font-mono text-[12px] focus:outline-none"
              onChange={(e) => setPrimaryRaw(e.target.value)}
              placeholder="canonical identity (e.g. their email)"
              type="text"
              value={primaryRaw}
            />
          </div>
          {/* Alias row */}
          <div className="grid grid-cols-[80px_140px_1fr] items-end gap-3">
            <span className="text-fg-muted block self-center font-mono text-[10px] tracking-[0.18em] uppercase">
              alias
            </span>
            <select
              aria-label="alias identity type"
              className="border-border bg-bg-secondary text-fg focus:border-accent h-8 w-full border px-2 font-mono text-[12px] focus:outline-none"
              onChange={(e) => setAliasType(e.target.value as IdentityKeyType)}
              value={aliasType}
            >
              {KEY_TYPES.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              aria-label="alias value (hashed before send)"
              autoComplete="off"
              className="border-border bg-bg-secondary text-fg focus:border-accent h-8 w-full border px-2 font-mono text-[12px] focus:outline-none"
              onChange={(e) => setAliasRaw(e.target.value)}
              placeholder="other identity that's the same person"
              type="text"
              value={aliasRaw}
            />
          </div>
          <div className="flex items-baseline justify-end gap-3">
            <button
              className="border-border bg-bg-secondary hover:bg-bg h-8 cursor-pointer border px-4 font-mono text-[10px] tracking-[0.18em] uppercase disabled:cursor-not-allowed disabled:opacity-40"
              disabled={mergeM.isPending || primaryRaw.trim() === '' || aliasRaw.trim() === ''}
              type="submit"
            >
              {mergeM.isPending ? 'merging…' : 'merge identities'}
            </button>
          </div>
        </div>
        {submitError && <div className="text-danger mt-2 font-mono text-[11px]">{submitError}</div>}
        {mergeM.error && (
          <div className="text-danger mt-2 font-mono text-[11px]">
            Merge failed: {mergeM.error.message}
          </div>
        )}
      </form>

      {result && (
        <div className="border-border border-b py-4">
          <div className="text-fg font-mono text-[12px]">
            {result.created ? 'Merged' : 'Re-activated'} alias{' '}
            <span className="text-fg-muted">{result.aliasPrefix}…</span> → primary{' '}
            <span className="text-fg-muted">{result.primaryPrefix}…</span> in scope{' '}
            <span className="text-fg-muted">{result.scopeId.slice(0, 8)}…</span>. Future lookups
            against the alias hash will return the primary's events.
          </div>
          {!undone && lastAlias && (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
                undo window · 7 days
              </span>
              <button
                className="border-border bg-bg-secondary hover:bg-bg h-7 cursor-pointer border px-3 font-mono text-[10px] tracking-[0.18em] uppercase disabled:cursor-not-allowed disabled:opacity-40"
                disabled={undoM.isPending}
                onClick={onUndo}
                type="button"
              >
                {undoM.isPending ? 'undoing…' : 'undo this merge'}
              </button>
            </div>
          )}
          {undone && (
            <div className="text-fg-secondary mt-2 font-mono text-[11px]">
              Undone. Future lookups against the alias hash will return its own events again. The
              merge row stays in audit history.
            </div>
          )}
          {undoM.error && (
            <div className="text-danger mt-2 font-mono text-[11px]">
              Undo failed: {undoM.error.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
