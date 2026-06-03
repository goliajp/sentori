import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { type IdentityLookupResp, orgsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { hashIdentity, type IdentityKeyType } from '@/lib/identity-hash'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

/**
 * v2.3 — cross-project user lookup (form + results).
 *
 * Privacy contract (also documented in
 * `docs/design/sdk-v2.3-redesign.md` §5):
 *
 *   - Operator types a raw identity value (email / phone / google_sub /
 *     ...) into the input. The browser hashes it via crypto.subtle
 *     BEFORE anything leaves the page.
 *   - Only the hash is POSTed to the server lookup endpoint.
 *   - URL state carries `?type=…&hash=…` — never the raw value.
 *     Refresh / share keeps the hash; raw value is gone the moment
 *     the operator hits Submit.
 *   - This view never persists, displays, or echoes the raw value.
 *
 * v2.4 — extracted from the legacy single-file UsersView so the
 * Users page can show an overview by default and reveal this form
 * on demand without losing deep-link / back-navigation behaviour.
 */

const KEY_TYPES: { description: string; label: string; value: IdentityKeyType }[] = [
  { description: 'Most common user identifier.', label: 'Email', value: 'email' },
  {
    description: 'E.164 normalised internally; passes any format.',
    label: 'Phone',
    value: 'phone',
  },
  {
    description: 'Google OAuth `sub` claim — opaque and stable.',
    label: 'Google Sub',
    value: 'googleSub',
  },
  {
    description: 'Apple sign-in `sub` claim.',
    label: 'Apple Sub',
    value: 'appleSub',
  },
  { description: 'App username, lowercase-normalised.', label: 'Username', value: 'username' },
]

export function UsersLookup() {
  const { currentOrg } = useOrg()
  const [keyType, setKeyType] = useUrlParam<IdentityKeyType>('type', 'email')
  const [hash, setHash] = useUrlParam<string>('hash', '')
  const [rawInput, setRawInput] = useState('')
  const [submitError, setSubmitError] = useState<null | string>(null)

  const lookupM = useMutation<IdentityLookupResp, Error, { clientHash: string; keyType: string }>({
    mutationFn: ({ clientHash, keyType }) =>
      orgsApi.usersLookup(currentOrg.slug, { clientHash, keyType }),
  })

  const seedFromUrl = () => {
    if (hash && /^[a-f0-9]{64}$/.test(hash)) {
      lookupM.mutate({ clientHash: hash, keyType })
    }
  }
  useFirstMount(seedFromUrl)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    const raw = rawInput.trim()
    if (raw === '') {
      setSubmitError('Enter an identity value (email, phone, sub, …) to look up.')
      return
    }
    try {
      const clientHash = await hashIdentity(keyType, raw)
      // Clear raw value from state IMMEDIATELY after hash — privacy contract.
      setRawInput('')
      setHash(clientHash)
      lookupM.mutate({ clientHash, keyType })
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Hashing failed; your browser may not support SubtleCrypto.'
      )
    }
  }

  const result = lookupM.data
  const isEmpty = !lookupM.isPending && result !== undefined && result.hits.length === 0

  return (
    <div>
      <form className="border-border border-y py-4" onSubmit={onSubmit}>
        <div className="grid grid-cols-[160px_1fr_auto] items-end gap-3">
          <label className="block">
            <span className="text-fg-muted mb-1 block font-mono text-[10px] tracking-[0.18em] uppercase">
              identity type
            </span>
            <select
              className="border-border bg-bg-secondary text-fg focus:border-accent h-8 w-full border px-2 font-mono text-[12px] focus:outline-none"
              onChange={(e) => setKeyType(e.target.value as IdentityKeyType)}
              value={keyType}
            >
              {KEY_TYPES.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-fg-muted mb-1 block font-mono text-[10px] tracking-[0.18em] uppercase">
              value (hashed before send)
            </span>
            <input
              autoComplete="off"
              className="border-border bg-bg text-fg placeholder:text-fg-muted focus:border-accent h-8 w-full border px-2 font-mono text-[12px] focus:outline-none"
              data-1p-ignore=""
              data-lpignore="true"
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={
                keyType === 'email'
                  ? 'lihao@golia.jp'
                  : keyType === 'phone'
                    ? '+81 90 1234 5678'
                    : 'raw value'
              }
              type="text"
              value={rawInput}
            />
          </label>

          <button
            className="bg-accent text-bg inline-flex h-8 items-center px-4 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={lookupM.isPending || rawInput.trim().length === 0}
            type="submit"
          >
            {lookupM.isPending ? 'hashing & querying…' : 'look up'}
          </button>
        </div>

        <p className="text-fg-muted mt-2 font-mono text-[10px]">
          {KEY_TYPES.find((k) => k.value === keyType)?.description ?? ''} The value gets SHA-256
          hashed by your browser before submission. Sentori never sees the raw value; the server
          stores only a per-org-salted fingerprint.
        </p>

        {submitError && <p className="text-danger mt-2 font-mono text-[11px]">{submitError}</p>}
      </form>

      {hash && !lookupM.data && !lookupM.isPending && (
        <p className="border-border text-fg-secondary border-y py-6 text-center font-mono text-[12px]">
          fingerprint <span className="text-fg">{hash.slice(0, 12)}…</span> loaded from URL. Click{' '}
          <b>look up</b> to query.
        </p>
      )}

      {lookupM.error && (
        <p className="border-border text-danger border-y py-4 text-center font-mono text-[11px]">
          Lookup failed. Try again.
        </p>
      )}

      {isEmpty && (
        <p className="border-border text-fg-secondary border-y py-6 text-center text-[13px]">
          No events match this identity in your org's projects.
          <br />
          <span className="text-fg-muted font-mono text-[11px]">
            (Either this user hasn't generated any events yet, or the hash doesn't match anything
            stored.)
          </span>
        </p>
      )}

      {result && result.hits.length > 0 && (
        <section className="mt-4 space-y-4">
          <header className="border-border border-b pb-2">
            <div className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
              {result.totalEvents.toLocaleString()} events · {result.hits.length} project
              {result.hits.length === 1 ? '' : 's'}
            </div>
            <p className="text-fg-muted mt-1 font-mono text-[11px]">
              fingerprint <span className="text-fg-secondary">{hash.slice(0, 12)}…</span> in scope{' '}
              <span className="text-fg-secondary">{result.scopeId.slice(0, 8)}</span>
            </p>
          </header>

          <table className="bench">
            <thead>
              <tr>
                <th>project</th>
                <th className="num">events</th>
                <th className="num">issues</th>
                <th className="num">first seen</th>
                <th className="num">last seen</th>
              </tr>
            </thead>
            <tbody>
              {result.hits.map((h) => (
                <tr key={h.projectId}>
                  <td className="lead">
                    <Link
                      className="text-fg hover:text-accent"
                      to={`/main/org/${currentOrg.slug}/issues?user=${encodeURIComponent(hash)}`}
                    >
                      <span className="font-mono text-[11px]">{h.projectId}</span>
                    </Link>
                  </td>
                  <td className="num tabular-nums">{h.eventCount.toLocaleString()}</td>
                  <td className="num tabular-nums">{h.issueCount.toLocaleString()}</td>
                  <td className="num">{formatRelative(h.firstSeen)}</td>
                  <td className="num">{formatRelative(h.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function useFirstMount(fn: () => void) {
  const [ran, setRan] = useState(false)
  if (!ran) {
    setRan(true)
    queueMicrotask(fn)
  }
}
