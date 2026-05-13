import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { adminApi, type IntegrationRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { ErrorState, LoadingState } from '@/components/states'

/**
 * Phase 43 sub-C — org-level integrations panel.
 *
 * Lives under `/integrations` (no per-project scope: an
 * integration is org-wide and shared across all projects under
 * that org). Lists current connections + offers a "Connect"
 * button per supported `kind` that kicks off the OAuth flow.
 *
 * Adapter list is hardcoded here for now — server side has the
 * same allowlist (`integrations.kind` CHECK). When new adapters
 * land they go in both places.
 */

const KNOWN_ADAPTERS: { kind: 'linear' | 'slack'; label: string; description: string }[] = [
  {
    description:
      'Auto-create Linear tickets from new Sentori issues; comment when resolved / regressed.',
    kind: 'linear',
    label: 'Linear',
  },
  {
    description: 'Post Block Kit notifications on new issue / regression / resolved.',
    kind: 'slack',
    label: 'Slack',
  },
]

export function IntegrationsView() {
  const { currentOrg } = useOrg()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [banner, setBanner] = useState<null | { kind: 'error' | 'success'; text: string }>(null)

  // Read connected=... / failed=... back from the OAuth callback redirect.
  useEffect(() => {
    const connected = searchParams.get('connected')
    const failed = searchParams.get('failed')
    if (connected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBanner({ kind: 'success', text: `Connected to ${connected}.` })
      searchParams.delete('connected')
      setSearchParams(searchParams, { replace: true })
    } else if (failed) {
      const err = searchParams.get('error') ?? 'unknown'
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBanner({ kind: 'error', text: `${failed} connect failed: ${err}` })
      searchParams.delete('failed')
      searchParams.delete('error')
      setSearchParams(searchParams, { replace: true })
    }
    // Run once on mount + whenever query params change.
  }, [searchParams, setSearchParams])

  const list = useQuery({
    queryFn: () => adminApi.listIntegrations(),
    queryKey: ['integrations'],
  })

  const revoke = useMutation({
    mutationFn: ({ kind, orgSlug }: { kind: string; orgSlug: string }) =>
      adminApi.revokeIntegration(kind, orgSlug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  })

  if (list.isLoading) return <LoadingState />
  if (list.error) return <ErrorState label="Failed to load integrations." />

  const connected = new Map<string, IntegrationRow>(
    (list.data ?? []).filter((r) => r.orgId === currentOrg.id).map((r) => [r.kind, r])
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-fg text-xl font-semibold">Integrations</h1>
        <p className="text-fg-muted mt-1 text-[12px]">
          Org-scoped connections. Auto-create / mirror Sentori issues into external tools.
        </p>
      </header>

      {banner && (
        <div
          className={`rounded-md border-l-4 px-3 py-2 text-[12px] ${
            banner.kind === 'success'
              ? 'border-accent/40 bg-accent/[0.04] text-fg'
              : 'border-red-400/40 bg-red-500/[0.04] text-red-300'
          }`}
        >
          {banner.text}
        </div>
      )}

      <ul className="space-y-3">
        {KNOWN_ADAPTERS.map((a) => {
          const row = connected.get(a.kind)
          return (
            <li
              className="border-border bg-bg-tertiary/30 flex items-start gap-4 rounded-md border p-4"
              key={a.kind}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-fg text-[14px] font-medium">{a.label}</h2>
                  {row && (
                    <span className="bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[10px] tracking-wider uppercase">
                      connected
                    </span>
                  )}
                </div>
                <p className="text-fg-muted mt-1 text-[12px]">{a.description}</p>
                {row && (
                  <dl className="text-fg-muted mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                    {Object.entries(row.display).map(([k, v]) =>
                      v ? (
                        <div className="contents" key={k}>
                          <dt>{k}</dt>
                          <dd className="text-fg font-mono">{String(v)}</dd>
                        </div>
                      ) : null
                    )}
                  </dl>
                )}
              </div>
              <div className="shrink-0">
                {row ? (
                  <button
                    className="text-fg-muted rounded-md border border-transparent px-2 py-1 text-[11px] hover:text-red-300"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ kind: a.kind, orgSlug: currentOrg.slug })}
                    type="button"
                  >
                    Disconnect
                  </button>
                ) : (
                  <a
                    className="border-border hover:border-accent/60 hover:text-fg text-fg-muted rounded-md border px-3 py-1 text-[11px]"
                    href={adminApi.integrationConnectUrl(a.kind, currentOrg.slug)}
                  >
                    Connect →
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
