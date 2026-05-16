// v0.8.4 — Certificate Transparency monitor dashboard.
//
// MVP layout: top half = the project's watched-domain list (add /
// remove). Bottom half = observation feed for the whole project,
// most-recent first. No per-domain drilldown yet — the feed is
// small enough that a flat list works.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function CertMonitorView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')

  const domainsQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listCertWatchDomains(projectId!),
    queryKey: ['cert-watch-domains', projectId],
  })
  const observationsQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listCertObservations(projectId!),
    queryKey: ['cert-observations', projectId],
  })

  const addM = useMutation({
    mutationFn: (domain: string) => adminApi.addCertWatchDomain(projectId!, domain),
    onSuccess: () => {
      setDraft('')
      void qc.invalidateQueries({ queryKey: ['cert-watch-domains', projectId] })
    },
  })
  const deleteM = useMutation({
    mutationFn: (watchId: string) => adminApi.deleteCertWatchDomain(projectId!, watchId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cert-watch-domains', projectId] }),
  })

  const domains = domainsQ.data ?? []
  const observations = observationsQ.data ?? []
  const trimmed = draft.trim()
  const canSubmit = trimmed.length >= 3 && trimmed.length <= 253 && !addM.isPending

  return (
    <div className="space-y-4">
      <section className="border-border rounded-md border">
        <header className="border-border bg-bg-tertiary/60 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Watched domains
          </span>
        </header>
        <ul className="divide-border divide-y">
          {domains.length === 0 && !domainsQ.isLoading && (
            <li className="text-fg-muted t-md px-3 py-3">
              Add a domain below. The server polls crt.sh every 10 min and fires an email when a new
              certificate appears in the public CT logs.
            </li>
          )}
          {domains.map((d) => (
            <li className="flex items-center justify-between gap-2 px-3 py-2" key={d.id}>
              <span className="t-md text-fg font-mono">{d.domain}</span>
              <button
                className="text-fg-muted hover:text-danger t-sm"
                onClick={() => deleteM.mutate(d.id)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form
          className="border-border flex items-center gap-2 border-t px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) addM.mutate(trimmed)
          }}
        >
          <input
            className="border-border bg-bg-tertiary text-fg focus:border-accent t-md flex-1 rounded-md border px-2 py-1 outline-none"
            maxLength={253}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="example.com"
            value={draft}
          />
          <button
            className="bg-accent text-bg t-md rounded px-3 py-1 font-medium disabled:opacity-50"
            disabled={!canSubmit}
            type="submit"
          >
            {addM.isPending ? 'Adding…' : 'Watch'}
          </button>
        </form>
      </section>

      <section className="border-border rounded-md border">
        <header className="border-border bg-bg-tertiary/60 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Recent observations
          </span>
        </header>
        {observationsQ.isLoading && <div className="text-fg-muted t-md px-3 py-3">Loading…</div>}
        {!observationsQ.isLoading && observations.length === 0 && (
          <div className="text-fg-muted t-md px-3 py-3">
            No certificates observed yet — newly-watched domains take up to 10 min for the first
            poll.
          </div>
        )}
        <ul className="divide-border divide-y">
          {observations.map((o) => (
            <li className="px-3 py-2" key={o.id}>
              <div className="t-md flex items-baseline justify-between gap-2">
                <span className="text-fg font-mono">{o.domain}</span>
                <span className="text-fg-muted t-sm font-mono tabular-nums">
                  {formatRelative(o.firstSeen)}
                </span>
              </div>
              <div className="text-fg t-md mt-1">{o.commonName ?? '(no common name)'}</div>
              <div className="text-fg-muted t-sm mt-1 font-mono">Issuer: {o.issuerName}</div>
              <div className="text-fg-muted t-sm mt-0.5 font-mono">
                Valid {o.notBefore} → {o.notAfter}
              </div>
              <a
                className="text-accent t-sm mt-1 inline-block hover:underline"
                href={`https://crt.sh/?id=${o.certId}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                crt.sh/{o.certId} ↗
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
