import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { adminApi, type IntegrationRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { ErrorState, LoadingState } from '@/components/states'

type ConnectMode = 'manual' | 'oauth'

const KNOWN_ADAPTERS_DETAIL: {
  kind: 'linear' | 'slack'
  label: string
  description: string
  mode: ConnectMode
}[] = [
  {
    description:
      'Auto-create Linear tickets from new Sentori issues; comment when resolved / regressed; webhook back-syncs Linear close → Sentori resolve.',
    kind: 'linear',
    label: 'Linear',
    mode: 'oauth',
  },
  {
    description:
      'Post Block Kit notifications on new issue / regression / resolved via an incoming webhook URL (no OAuth needed).',
    kind: 'slack',
    label: 'Slack',
    mode: 'manual',
  },
]

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

const KNOWN_ADAPTERS = KNOWN_ADAPTERS_DETAIL

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
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-fg text-xl font-semibold">Integrations</h1>
        <p className="text-fg-muted t-md mt-1">
          Org-scoped connections. Auto-create / mirror Sentori issues into external tools.
        </p>
      </header>

      {banner && (
        <div
          className={`t-md rounded-md border-l-4 px-3 py-2 ${
            banner.kind === 'success'
              ? 'border-accent/40 bg-accent/[0.04] text-fg'
              : 'border-red-400/40 bg-red-500/[0.04] text-[color:var(--color-danger)]'
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
                    <span className="bg-accent/10 text-accent t-sm rounded px-1.5 py-0.5 tracking-wider uppercase">
                      connected
                    </span>
                  )}
                </div>
                <p className="text-fg-muted t-md mt-1">{a.description}</p>
                {row && (
                  <dl className="text-fg-muted t-sm mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
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
                    className="text-fg-muted t-sm rounded-md border border-transparent px-2 py-1 hover:text-[color:var(--color-danger)]"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ kind: a.kind, orgSlug: currentOrg.slug })}
                    type="button"
                  >
                    Disconnect
                  </button>
                ) : a.mode === 'oauth' ? (
                  <a
                    className="border-border hover:border-accent/60 hover:text-fg text-fg-muted t-sm rounded-md border px-3 py-1"
                    href={adminApi.integrationConnectUrl(a.kind, currentOrg.slug)}
                  >
                    Connect →
                  </a>
                ) : (
                  <SlackConfigureForm
                    onConfigured={() =>
                      queryClient.invalidateQueries({ queryKey: ['integrations'] })
                    }
                    orgSlug={currentOrg.slug}
                  />
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Phase 43 sub-E.02 — inline "paste webhook URL" form for Slack.
 * Toggle open via "Configure →" button; submits to
 * `POST /admin/api/integrations/slack/configure`.
 */
function SlackConfigureForm({
  onConfigured,
  orgSlug,
}: {
  onConfigured: () => void
  orgSlug: string
}) {
  const [open, setOpen] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [channelLabel, setChannelLabel] = useState('')
  const [error, setError] = useState<null | string>(null)

  const submit = useMutation({
    mutationFn: () =>
      adminApi.configureIntegration('slack', {
        channelLabel: channelLabel.trim() || undefined,
        orgSlug,
        webhookUrl: webhookUrl.trim(),
      }),
    onError: (e: unknown) => {
      const body = (e as { body?: { detail?: string } } | undefined)?.body
      setError(body?.detail ?? 'invalid config')
    },
    onSuccess: () => {
      setOpen(false)
      setWebhookUrl('')
      setChannelLabel('')
      setError(null)
      onConfigured()
    },
  })

  if (!open) {
    return (
      <button
        className="border-border hover:border-accent/60 hover:text-fg text-fg-muted t-sm rounded-md border px-3 py-1"
        onClick={() => setOpen(true)}
        type="button"
      >
        Configure →
      </button>
    )
  }
  return (
    <form
      className="flex w-72 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate()
      }}
    >
      <input
        aria-label="Slack incoming webhook URL"
        className="border-border bg-bg-tertiary text-fg t-sm rounded-md border px-2 py-1 font-mono"
        onChange={(e) => setWebhookUrl(e.target.value)}
        placeholder="https://hooks.slack.com/services/T…/B…/…"
        required
        spellCheck={false}
        type="url"
        value={webhookUrl}
      />
      <input
        aria-label="Channel label (display only)"
        className="border-border bg-bg-tertiary text-fg t-sm rounded-md border px-2 py-1"
        onChange={(e) => setChannelLabel(e.target.value)}
        placeholder="#sentori-alerts (optional)"
        type="text"
        value={channelLabel}
      />
      {error && <p className="t-sm text-[color:var(--color-danger)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          className="text-fg-muted hover:text-fg t-sm"
          onClick={() => setOpen(false)}
          type="button"
        >
          Cancel
        </button>
        <button
          className="border-accent/60 text-accent hover:bg-accent/10 t-sm rounded-md border px-2 py-1 disabled:opacity-50"
          disabled={submit.isPending || !webhookUrl.trim()}
          type="submit"
        >
          {submit.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
