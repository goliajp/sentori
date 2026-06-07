// v2.11 — Push notifications credential CRUD dashboard.
//
// Two stacked Cards, mirroring the cert-monitor / health module pattern:
//
//   1. Configured providers — DataTable<{ provider, config summary,
//      updated_at, delete }> showing every credential row stored on
//      `push_credentials`. Encrypted secret blob is never surfaced.
//
//   2. Add / update credential — Provider dropdown + config JSON
//      textarea + secret JSON textarea + Save Button. On Save:
//      `PUT /admin/api/projects/:id/push/credentials` upserts the
//      row. Errors surface in an Alert above the form.
//
// Device list + send-history surfaces are intentionally deferred —
// the v2.11 dashboard ships credential management only. v2.12 (or
// later) adds the device + sends views once the server endpoints
// for those land.

import { Alert, Button, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi, type PushCredentialRow, type PushProviderKind } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

const PROVIDER_LABELS: Record<PushProviderKind, string> = {
  apns: 'APNs (iOS)',
  fcm: 'FCM v1 (Android)',
  webpush: 'Web Push (VAPID)',
  hcm: 'HCM (Huawei)',
  mipush: 'MiPush (Xiaomi)',
}

const PROVIDER_OPTIONS: PushProviderKind[] = ['apns', 'fcm', 'webpush', 'hcm', 'mipush']

export function PushView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const qc = useQueryClient()

  const credsQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listPushCredentials(projectId!),
    queryKey: qk.pushCredentials(projectId),
  })

  const upsertM = useMutation({
    mutationFn: ({
      provider,
      config,
      secret,
    }: {
      provider: PushProviderKind
      config: unknown
      secret: unknown
    }) => adminApi.upsertPushCredential(projectId!, provider, config, secret),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.pushCredentials(projectId) }),
  })

  const deleteM = useMutation({
    mutationFn: (provider: PushProviderKind) => adminApi.deletePushCredential(projectId!, provider),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.pushCredentials(projectId) }),
  })

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Push" />
        <Card>
          <EmptyState
            description="Pick a project from the sidebar to configure push credentials."
            title="No project selected"
          />
        </Card>
      </div>
    )
  }

  const rows = credsQ.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'push' },
        ]}
        subtitle="Configure APNs / FCM / Web Push / HCM / MiPush provider credentials. Encrypted at rest via SENTORI_SESSION_SECRET-derived AES-256-GCM."
        title="Push"
      />

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Configured providers</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {rows.length} active
          </span>
        </header>

        {credsQ.error && (
          <Alert title="Failed to load credentials" variant="danger">
            Refresh to retry.
          </Alert>
        )}

        {!credsQ.isLoading && !credsQ.error && rows.length === 0 && (
          <EmptyState
            description="Add a credential below. Each provider can have one row per project."
            title="No push providers configured yet"
          />
        )}

        {rows.length > 0 && (
          <DataTable<PushCredentialRow>
            columns={[
              {
                key: 'provider',
                label: 'Provider',
                render: (_v, r) => (
                  <span className="text-fg font-mono text-[13px]">
                    {PROVIDER_LABELS[r.provider]}
                  </span>
                ),
              },
              {
                key: 'config',
                label: 'Config summary',
                render: (_v, r) => (
                  <span className="text-fg-secondary font-mono text-[11px]">
                    {summariseConfig(r.provider, r.config)}
                  </span>
                ),
              },
              {
                key: 'updatedAt',
                label: 'Updated',
                width: '180px',
                render: (_v, r) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {formatRelative(r.updatedAt)}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'delete',
                label: '',
                width: '110px',
                render: (_v, r) => (
                  <Button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the ${PROVIDER_LABELS[r.provider]} credential? Sends to this provider will start failing until a new one is uploaded.`
                        )
                      ) {
                        deleteM.mutate(r.provider)
                      }
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
            density="compact"
            rowKey={(r) => r.provider}
            rows={rows}
            striped
          />
        )}
      </Card>

      <UpsertCredentialForm
        onSubmit={(provider, config, secret) => upsertM.mutate({ config, provider, secret })}
        pending={upsertM.isPending}
        error={upsertM.error?.message ?? null}
      />
    </div>
  )
}

function summariseConfig(provider: PushProviderKind, config: Record<string, unknown>): string {
  switch (provider) {
    case 'apns': {
      const team = config.team_id as string | undefined
      const bundle = config.bundle_id as string | undefined
      const env = config.env_default as string | undefined
      return [team, bundle, env].filter(Boolean).join(' · ')
    }
    case 'fcm': {
      const proj = config.project_id as string | undefined
      return proj ?? '(no project id)'
    }
    case 'webpush': {
      const pub = config.vapidPublic as string | undefined
      const contact = config.contact as string | undefined
      return [pub ? `key ${pub.slice(0, 10)}…` : null, contact].filter(Boolean).join(' · ')
    }
    case 'hcm':
    case 'mipush': {
      const appId = (config.app_id ?? config.appId) as string | undefined
      return appId ?? '(no app id)'
    }
    default:
      return ''
  }
}

function UpsertCredentialForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (provider: PushProviderKind, config: unknown, secret: unknown) => void
  pending: boolean
  error: null | string
}) {
  const [provider, setProvider] = useState<PushProviderKind>('apns')
  const [configText, setConfigText] = useState('')
  const [secretText, setSecretText] = useState('')
  const [parseError, setParseError] = useState<null | string>(null)

  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Add / update credential</h2>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          Encrypted at rest
        </span>
      </header>

      {(error ?? parseError) && (
        <Alert title="Couldn't save" variant="danger">
          {error ?? parseError}
        </Alert>
      )}

      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setParseError(null)
          let config: unknown
          let secret: unknown
          try {
            config = configText.trim() === '' ? {} : JSON.parse(configText)
          } catch (err) {
            setParseError(`config JSON parse: ${(err as Error).message}`)
            return
          }
          try {
            secret = JSON.parse(secretText)
          } catch (err) {
            setParseError(`secret JSON parse: ${(err as Error).message}`)
            return
          }
          onSubmit(provider, config, secret)
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            provider
          </span>
          <select
            className="border-border bg-bg text-fg gds-h-sm gds-pad-x rounded border font-mono text-[13px]"
            onChange={(e) => setProvider(e.target.value as PushProviderKind)}
            value={provider}
          >
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            config (JSON, non-secret)
          </span>
          <textarea
            className="border-border bg-bg text-fg gds-pad rounded border font-mono text-[12px]"
            onChange={(e) => setConfigText(e.target.value)}
            placeholder={configPlaceholder(provider)}
            rows={6}
            value={configText}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            secret (JSON, sealed before save)
          </span>
          <textarea
            className="border-border bg-bg text-fg gds-pad rounded border font-mono text-[12px]"
            onChange={(e) => setSecretText(e.target.value)}
            placeholder={secretPlaceholder(provider)}
            rows={6}
            value={secretText}
          />
        </label>

        <div className="border-border/40 flex items-center justify-end gap-3 border-t pt-3">
          <span className="text-fg-muted font-mono text-[10px]">
            Sealed via AES-256-GCM. Never returned by GET.
          </span>
          <Button disabled={pending} loading={pending} type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Card>
  )
}

function configPlaceholder(provider: PushProviderKind): string {
  switch (provider) {
    case 'apns':
      return JSON.stringify(
        {
          key_id: 'ABCDEFGHIJ',
          team_id: '1234567890',
          bundle_id: 'com.example.app',
          env_default: 'production',
        },
        null,
        2
      )
    case 'fcm':
      return JSON.stringify({ project_id: 'my-fcm-project' }, null, 2)
    case 'webpush':
      return JSON.stringify({ vapidPublic: 'BNc...', contact: 'mailto:dev@example.com' }, null, 2)
    case 'hcm':
    case 'mipush':
      return JSON.stringify({ app_id: '...', region: 'global' }, null, 2)
    default:
      return ''
  }
}

function secretPlaceholder(provider: PushProviderKind): string {
  switch (provider) {
    case 'apns':
      return JSON.stringify(
        { p8: '-----BEGIN PRIVATE KEY-----\\n…\\n-----END PRIVATE KEY-----' },
        null,
        2
      )
    case 'fcm':
      return '{ "type": "service_account", "project_id": "…", "private_key": "…", "client_email": "…", "token_uri": "https://oauth2.googleapis.com/token" }'
    case 'webpush':
      return JSON.stringify(
        { vapidPrivate: '-----BEGIN EC PRIVATE KEY-----\\n…\\n-----END EC PRIVATE KEY-----' },
        null,
        2
      )
    case 'hcm':
    case 'mipush':
      return JSON.stringify({ appSecret: '…' }, null, 2)
    default:
      return ''
  }
}
