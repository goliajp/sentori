import { Alert, Button, Card, DataTable, EmptyState, Input, PageHeader } from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

type WatchDomain = { id: string; domain: string }
type Observation = {
  id: string
  domain: string
  commonName: null | string
  issuerName: string
  notBefore: string
  notAfter: string
  firstSeen: string
  certId: string | number
}

/**
 * Certificate Transparency monitor — pulls public CT logs every 10
 * min and alerts when a new certificate appears for a watched
 * domain. Two stacked Cards: domain add/remove + observation feed.
 */
export function CertMonitorView() {
  const { currentOrg, currentProject } = useOrg()
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

  const domains = (domainsQ.data ?? []) as WatchDomain[]
  const observations = (observationsQ.data ?? []) as Observation[]
  const trimmed = draft.trim()
  const canSubmit = trimmed.length >= 3 && trimmed.length <= 253 && !addM.isPending

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'cert monitor' },
        ]}
        subtitle="Public CT logs · 10 min poll"
        title="Cert monitor"
      />

      <Card>
        <header className="border-border-muted mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Watched domains</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {domains.length} watched
          </span>
        </header>

        {domains.length === 0 && !domainsQ.isLoading && (
          <EmptyState
            description="Add a domain below. The server polls crt.sh every 10 min and emails when a new certificate lands."
            title="No domains watched yet"
          />
        )}

        {domains.length > 0 && (
          <DataTable<WatchDomain>
            columns={[
              {
                key: 'domain',
                label: 'Domain',
                render: (_v, d) => (
                  <span className="text-fg font-mono text-[13px]">{d.domain}</span>
                ),
              },
              {
                align: 'right',
                key: 'remove',
                label: '',
                width: '110px',
                render: (_v, d) => (
                  <Button onClick={() => deleteM.mutate(d.id)} size="sm" variant="ghost">
                    Remove
                  </Button>
                ),
              },
            ]}
            density="compact"
            rowKey="id"
            rows={domains}
            striped
          />
        )}

        <form
          className="border-border-muted mt-4 flex items-end gap-3 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) addM.mutate(trimmed)
          }}
        >
          <label className="flex-1">
            <span className="text-fg-muted mb-1 block font-mono text-[10px] tracking-[0.18em] uppercase">
              domain
            </span>
            <Input
              maxLength={253}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="example.com"
              value={draft}
            />
          </label>
          <Button disabled={!canSubmit} loading={addM.isPending} type="submit" variant="primary">
            Watch
          </Button>
        </form>
      </Card>

      <Card>
        <header className="border-border-muted mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Recent observations</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {observations.length} seen
          </span>
        </header>

        {observationsQ.error && (
          <Alert title="Failed to load observations" variant="danger">
            Refresh to retry.
          </Alert>
        )}

        {!observationsQ.isLoading && !observationsQ.error && observations.length === 0 && (
          <EmptyState
            description="Newly-watched domains take up to 10 min for the first poll."
            title="No certificates observed yet"
          />
        )}

        {observations.length > 0 && (
          <ul className="space-y-2">
            {observations.map((o) => (
              <li className="border-border-muted border-b py-3 last:border-0" key={o.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-fg font-mono text-[13px]">{o.domain}</span>
                  <span className="text-fg-muted font-mono text-[10px] tabular-nums">
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
        )}
      </Card>
    </div>
  )
}
