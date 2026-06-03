// v0.8.4 — Certificate Transparency monitor.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { SubSection } from '@/components/SubSection'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

export function CertMonitorView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')

  const domainsQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listCertWatchDomains(projectId!),
    queryKey: qk.certWatchDomains(projectId),
  })
  const observationsQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listCertObservations(projectId!),
    queryKey: qk.certObservations(projectId),
  })

  const addM = useMutation({
    mutationFn: (domain: string) => adminApi.addCertWatchDomain(projectId!, domain),
    onSuccess: () => {
      setDraft('')
      void qc.invalidateQueries({ queryKey: qk.certWatchDomains(projectId) })
    },
  })
  const deleteM = useMutation({
    mutationFn: (watchId: string) => adminApi.deleteCertWatchDomain(projectId!, watchId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.certWatchDomains(projectId) }),
  })

  const domains = domainsQ.data ?? []
  const observations = observationsQ.data ?? []
  const trimmed = draft.trim()
  const canSubmit = trimmed.length >= 3 && trimmed.length <= 253 && !addM.isPending

  return (
    <div className="sentori-page-in">
      <PageHeader subtitle="public CT logs · 10 min poll" title="Cert monitor" />

      <SubSection sub={`${domains.length} watched`} title="Watched domains">
        <ul>
          {domains.length === 0 && !domainsQ.isLoading && (
            <li className="border-border text-fg-secondary border-y py-4 text-[13px]">
              Add a domain below. The server polls crt.sh every 10 min and emails when a new
              certificate appears in the public CT logs.
            </li>
          )}
          {domains.map((d, i) => (
            <li
              className={`flex items-center justify-between gap-3 py-2.5 ${
                i === 0 ? 'border-t' : ''
              } border-border-muted border-b`}
              key={d.id}
            >
              <span className="text-fg font-mono text-[13px]">{d.domain}</span>
              <button
                className="text-fg-muted hover:text-danger font-mono text-[11px] tracking-[0.08em] uppercase transition-colors"
                onClick={() => deleteM.mutate(d.id)}
                type="button"
              >
                remove
              </button>
            </li>
          ))}
        </ul>

        <form
          className="border-border mt-3 flex items-center gap-3 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) addM.mutate(trimmed)
          }}
        >
          <label
            className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase"
            htmlFor="cert-domain"
          >
            domain
          </label>
          <input
            className="border-border text-fg placeholder:text-fg-muted focus:border-accent flex-1 border-b bg-transparent py-1 font-mono text-[13px] focus:outline-none"
            id="cert-domain"
            maxLength={253}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="example.com"
            value={draft}
          />
          <button
            className="bg-accent text-bg px-3 py-1 font-mono text-[11px] tracking-[0.1em] uppercase disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit}
            type="submit"
          >
            {addM.isPending ? 'adding…' : 'watch'}
          </button>
        </form>
      </SubSection>

      <SubSection sub={`${observations.length} seen`} title="Recent observations">
        {observationsQ.isLoading && (
          <p className="border-border text-fg-secondary border-y py-4 text-center text-[13px]">
            Loading…
          </p>
        )}
        {!observationsQ.isLoading && observations.length === 0 && (
          <p className="border-border text-fg-secondary border-y py-6 text-center text-[13px]">
            No certificates observed yet — newly-watched domains take up to 10 min for the first
            poll.
          </p>
        )}
        <ul>
          {observations.map((o) => (
            <li
              className="border-border-muted first:border-border border-b py-3 first:border-t"
              key={o.id}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-fg font-mono text-[13px]">{o.domain}</span>
                <span className="text-fg-muted font-mono text-[10px] tracking-[0.05em] tabular-nums">
                  {formatRelative(o.firstSeen)}
                </span>
              </div>
              <div className="text-fg-secondary mt-1 text-[13px]">
                {o.commonName ?? '(no common name)'}
              </div>
              <div className="text-fg-muted mt-1.5 flex flex-wrap items-baseline gap-x-3 font-mono text-[11px]">
                <span>issuer · {o.issuerName}</span>
                <span>
                  valid {o.notBefore} → {o.notAfter}
                </span>
                <a
                  className="text-accent ml-auto hover:underline"
                  href={`https://crt.sh/?id=${o.certId}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  crt.sh/{o.certId} ↗
                </a>
              </div>
            </li>
          ))}
        </ul>
      </SubSection>
    </div>
  )
}
