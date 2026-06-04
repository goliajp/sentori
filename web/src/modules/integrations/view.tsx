// v1.3 W11 — integrations settings page.
//
// Replaces the v1.1 read-only list with a full per-org connection
// management UI. Each adapter gets one card showing its current
// connection state + actions to connect / reconnect / disconnect.
// Linear runs via OAuth (server 302's to Linear); Slack / GitHub /
// GitLab / Jira use a per-kind manual-config modal.
//
// Mandatory UX checklist (per webapp-UX-is-delivery memory):
//   1. Entry point          → sidebar "Integrations" module link
//   2. Empty state          → all five cards visible disconnected
//   3. Loading state        → skeleton card row while query in flight
//   4. Error state          → red banner with structured-error hint
//   5. Success feedback     → inline "✓ connected" / "✓ disconnected"
//                              with a 2s pulse
//   6. Edit path            → Reconnect button on connected cards
//   7. Delete path          → Disconnect → confirm dialog
//   8. No docs required     → each card has a one-liner explaining
//                              what it does + which secret to paste

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  adminApi,
  type IntegrationKind,
  type IntegrationRow,
  type IntegrationTemplateRow,
  isStructuredError,
} from '@/api/client'
import { PageHeader } from '@goliapkg/gds'

import { qk } from '@/api/query-keys'
import { useUrlParam } from '@/lib/url-state'
import { useOrg } from '@/auth/orgContext'

type AdapterDef = {
  description: string
  /** Single-mode adapters use these directly. Multi-mode adapters
   *  use `modes` and `fields` may be empty. */
  fields: ManualField[]
  kind: IntegrationKind
  /** OAuth-based adapters skip the modal — their Connect button
   *  navigates to the connect URL which 302's externally. */
  manualConfig: boolean
  /** v1.3 W12/W13 — multi-mode adapters (github PAT/App, jira
   *  Cloud/Server) render a top-of-modal radio toggle whose value
   *  is submitted under `tagField` (e.g. `mode` for github,
   *  `deployment` for jira). */
  modes?: AdapterMode[]
  name: string
  /** Name of the request field that carries the mode id. */
  tagField?: string
}

type AdapterMode = {
  fields: ManualField[]
  /** Wire value — must match the adapter's discriminator on the
   *  server side. */
  id: string
  label: string
  /** v1.4 W20 — when true, this mode's "Connect" button triggers
   *  the OAuth redirect (top-level window.location.href = connect
   *  URL) instead of POSTing to /configure. The form fields are
   *  ignored. */
  viaOAuth?: boolean
}

type ManualField = {
  hint?: string
  key: string
  label: string
  placeholder?: string
  required: boolean
  type: 'password' | 'textarea' | 'text'
}

const ADAPTERS: AdapterDef[] = [
  {
    description:
      'Open + close Linear tickets when Sentori issues land or resolve. Linear posts back via webhook so the linked-issue panel stays fresh.',
    fields: [],
    kind: 'linear',
    manualConfig: false,
    name: 'Linear',
  },
  {
    description:
      'Post a Block Kit message to a Slack channel when a new issue lands or a previously-resolved one regresses. Paste the incoming-webhook URL from your Slack app.',
    fields: [
      {
        hint: 'From your Slack app → Incoming Webhooks.',
        key: 'webhookUrl',
        label: 'Webhook URL',
        placeholder: 'https://hooks.slack.com/services/T.../B.../...',
        required: true,
        type: 'password',
      },
      {
        hint: 'Optional. Shown on this card as a connection summary.',
        key: 'channelLabel',
        label: 'Channel label',
        placeholder: '#sentori-alerts',
        required: false,
        type: 'text',
      },
    ],
    kind: 'slack',
    manualConfig: true,
    name: 'Slack',
  },
  {
    description:
      'Open + close GitHub Issues. Choose Personal Access Token for quick setup, or GitHub App for production multi-org.',
    fields: [],
    kind: 'github',
    manualConfig: true,
    modes: [
      {
        fields: [
          {
            hint: 'Needs Issues read + write on the target repo.',
            key: 'accessToken',
            label: 'Personal access token',
            placeholder: 'ghp_… or github_pat_…',
            required: true,
            type: 'password',
          },
          {
            hint: 'Issues land here by default.',
            key: 'defaultRepo',
            label: 'Default repo',
            placeholder: 'owner/repo',
            required: true,
            type: 'text',
          },
        ],
        id: 'pat',
        label: 'Personal access token',
      },
      {
        fields: [
          {
            hint: 'Numeric App ID from your GitHub App settings page.',
            key: 'appId',
            label: 'App ID',
            placeholder: '123456',
            required: true,
            type: 'text',
          },
          {
            hint: 'Numeric installation ID (under Installed apps on your org).',
            key: 'installationId',
            label: 'Installation ID',
            placeholder: '987654',
            required: true,
            type: 'text',
          },
          {
            hint: 'Full PEM including BEGIN/END lines.',
            key: 'privateKey',
            label: 'Private key (PEM)',
            placeholder: '-----BEGIN RSA PRIVATE KEY-----\n…',
            required: true,
            type: 'textarea',
          },
          {
            hint: 'Issues land here. Must be a repo the App is installed on.',
            key: 'defaultRepo',
            label: 'Default repo',
            placeholder: 'owner/repo',
            required: true,
            type: 'text',
          },
        ],
        id: 'app',
        label: 'GitHub App',
      },
    ],
    name: 'GitHub Issues',
    tagField: 'mode',
  },
  {
    description:
      'Open + close GitLab Issues. Works for gitlab.com and self-hosted. Paste a project access token + the project id.',
    fields: [
      {
        hint: 'PAT with `api` scope (or read_api + write_repository).',
        key: 'accessToken',
        label: 'Access token',
        placeholder: 'glpat-…',
        required: true,
        type: 'password',
      },
      {
        hint: 'Numeric id (e.g. 12345) or URL-encoded group/project.',
        key: 'projectId',
        label: 'Project id',
        placeholder: '12345 or myteam%2Fmyapp',
        required: true,
        type: 'text',
      },
      {
        hint: 'Optional. Leave blank for gitlab.com.',
        key: 'baseUrl',
        label: 'Base URL',
        placeholder: 'https://gitlab.mycompany.com',
        required: false,
        type: 'text',
      },
    ],
    kind: 'gitlab',
    manualConfig: true,
    name: 'GitLab Issues',
  },
  {
    description:
      'Open + close Jira issues. Cloud uses email + API token; Server / Data Center uses a PAT and your instance base URL. Workflow transitions resolve by name ("Done" / "In Progress").',
    fields: [],
    kind: 'jira',
    manualConfig: true,
    modes: [
      {
        // v1.4 W20 — Atlassian 3LO. The dashboard's "Connect" button
        // for this mode does window.location.href = connect URL,
        // which 302's to https://auth.atlassian.com/authorize. After
        // callback, the operator returns to Sentori connected.
        // project_key gets prompted as a follow-up since OAuth
        // doesn't know which Jira project to write to.
        fields: [
          {
            hint: 'e.g. ENG. Found in your Jira project URL.',
            key: 'projectKey',
            label: 'Project key (set after connecting)',
            placeholder: 'ENG',
            required: false,
            type: 'text',
          },
        ],
        id: 'oauth',
        label: 'Cloud (OAuth)',
        viaOAuth: true,
      },
      {
        fields: [
          {
            key: 'email',
            label: 'Email',
            placeholder: 'you@yourco.com',
            required: true,
            type: 'text',
          },
          {
            hint: 'From id.atlassian.com → Security → API tokens.',
            key: 'apiToken',
            label: 'API token',
            placeholder: 'ATATT3xFfGF0…',
            required: true,
            type: 'password',
          },
          {
            hint: 'Without protocol.',
            key: 'site',
            label: 'Site',
            placeholder: 'mycompany.atlassian.net',
            required: true,
            type: 'text',
          },
          {
            hint: 'e.g. ENG. Found in your Jira project URL.',
            key: 'projectKey',
            label: 'Project key',
            placeholder: 'ENG',
            required: true,
            type: 'text',
          },
          {
            hint: 'Optional. Defaults to "Bug".',
            key: 'issueType',
            label: 'Issue type',
            placeholder: 'Bug',
            required: false,
            type: 'text',
          },
        ],
        id: 'cloud',
        label: 'Cloud (API token)',
      },
      {
        fields: [
          {
            hint: 'Personal Access Token from your Jira user → Profile → PATs.',
            key: 'accessToken',
            label: 'Personal access token',
            placeholder: 'ATATT…',
            required: true,
            type: 'password',
          },
          {
            hint: 'Including protocol. No trailing slash.',
            key: 'baseUrl',
            label: 'Base URL',
            placeholder: 'https://jira.mycompany.com',
            required: true,
            type: 'text',
          },
          {
            hint: 'e.g. ENG. Found in your Jira project URL.',
            key: 'projectKey',
            label: 'Project key',
            placeholder: 'ENG',
            required: true,
            type: 'text',
          },
          {
            hint: 'Optional. Defaults to "Bug".',
            key: 'issueType',
            label: 'Issue type',
            placeholder: 'Bug',
            required: false,
            type: 'text',
          },
        ],
        id: 'server',
        label: 'Jira Server / DC',
      },
    ],
    name: 'Jira',
    tagField: 'deployment',
  },
]

export function IntegrationsView() {
  const { currentOrg } = useOrg()
  const integrationsQ = useQuery({
    queryFn: adminApi.listIntegrations,
    queryKey: qk.integrations(),
  })
  const connections = (integrationsQ.data ?? []).filter((r) => r.orgSlug === currentOrg.slug)

  const canEdit = currentOrg.role === 'owner' || currentOrg.role === 'admin'
  // v1.4 W23 — top-of-page tab toggle between "Connections" (the
  // per-org adapter grid this page has always shown) and "Templates"
  // (cross-org reusable configurations, owned by the operator).
  // v2.1 — `?tab=` URL state so refresh / share-link keeps the tab.
  const [tab, setTab] = useUrlParam<'connections' | 'templates'>('tab', 'connections', (raw) =>
    raw === 'connections' || raw === 'templates' ? raw : null
  )

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'integrations' },
        ]}
        subtitle={`Per-org connections · ${connections.length} active`}
        title="Integrations"
      />

      <div className="border-border mb-4 flex gap-1 border-b">
        <TabButton active={tab === 'connections'} onClick={() => setTab('connections')}>
          Connections
        </TabButton>
        <TabButton active={tab === 'templates'} onClick={() => setTab('templates')}>
          Templates
        </TabButton>
      </div>

      {tab === 'connections' && (
        <>
          {!canEdit && <ReadOnlyHint />}

          {integrationsQ.isLoading && <SkeletonGrid />}

          {integrationsQ.error && (
            <ErrorBanner message={hintOf(integrationsQ.error) ?? 'Failed to load integrations.'} />
          )}

          {!integrationsQ.isLoading && !integrationsQ.error && (
            <div className="grid gap-3 lg:grid-cols-2">
              {ADAPTERS.map((adapter) => (
                <AdapterCard
                  adapter={adapter}
                  canEdit={canEdit}
                  key={adapter.kind}
                  orgSlug={currentOrg.slug}
                  row={connections.find((c) => c.kind === adapter.kind) ?? null}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'templates' && <TemplatesTab />}
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      className={`-mb-px border-b-2 px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase ${
        active ? 'border-accent text-fg' : 'text-fg-secondary hover:text-fg border-transparent'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

function AdapterCard({
  adapter,
  canEdit,
  orgSlug,
  row,
}: {
  adapter: AdapterDef
  canEdit: boolean
  orgSlug: string
  row: IntegrationRow | null
}) {
  const qc = useQueryClient()
  const [modal, setModal] = useState<'connect' | 'disconnect' | null>(null)
  const [recentAction, setRecentAction] = useState<'connected' | 'disconnected' | null>(null)

  const connected = row !== null

  const revokeM = useMutation({
    mutationFn: () => adminApi.revokeIntegration(adapter.kind, orgSlug),
    onSuccess: () => {
      setModal(null)
      setRecentAction('disconnected')
      void qc.invalidateQueries({ queryKey: qk.integrations() })
      window.setTimeout(() => setRecentAction(null), 2000)
    },
  })

  const configureM = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminApi.configureIntegration(adapter.kind, { orgSlug, ...body }),
    onSuccess: () => {
      setModal(null)
      setRecentAction('connected')
      void qc.invalidateQueries({ queryKey: qk.integrations() })
      window.setTimeout(() => setRecentAction(null), 2000)
    },
  })

  const onConnect = () => {
    if (adapter.manualConfig) {
      setModal('connect')
    } else {
      // OAuth → top-level redirect.
      window.location.href = adminApi.integrationConnectUrl(adapter.kind, orgSlug)
    }
  }

  return (
    <div className="border-border bg-bg-tertiary/20 relative rounded-md border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className="text-fg"
          style={{
            fontSize: '15px',
            fontVariationSettings: "'wdth' 100, 'opsz' 24, 'wght' 600",
          }}
        >
          {adapter.name}
        </h3>
        <ConnectionPill connected={connected} recentAction={recentAction} />
      </div>

      <p className="text-fg-soft mt-1 text-[12px] leading-relaxed">{adapter.description}</p>

      {connected && row && <ConnectedSummary display={row.display} />}

      <div className="mt-3 flex items-center gap-2">
        {!connected && (
          <button
            className="bg-accent text-bg t-sm rounded px-3 py-1.5 font-medium disabled:opacity-50"
            disabled={!canEdit}
            onClick={onConnect}
            type="button"
          >
            Connect
          </button>
        )}
        {connected && (
          <>
            <button
              className="border-border text-fg t-sm rounded border px-3 py-1.5 disabled:opacity-50"
              disabled={!canEdit}
              onClick={onConnect}
              type="button"
            >
              Reconnect
            </button>
            <button
              className="text-danger border-danger/50 t-sm rounded border px-3 py-1.5 disabled:opacity-50"
              disabled={!canEdit}
              onClick={() => setModal('disconnect')}
              type="button"
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {modal === 'connect' && (
        <ConnectModal
          adapter={adapter}
          error={configureM.error}
          isExisting={connected}
          onClose={() => setModal(null)}
          onOAuthConnect={() => {
            // Same pattern as Linear's OAuth: top-level redirect to
            // the adapter's connect URL. The server 302's onward to
            // the OAuth provider (Atlassian for Jira) which lands back
            // here at /integrations/{kind}/callback.
            window.location.href = adminApi.integrationConnectUrl(adapter.kind, orgSlug)
          }}
          onSubmit={(values) => configureM.mutate(values)}
          pending={configureM.isPending}
        />
      )}
      {modal === 'disconnect' && (
        <ConfirmDialog
          confirmLabel="Disconnect"
          danger
          error={revokeM.error}
          message={`Disconnecting ${adapter.name} stops new outbound issue sync. Existing linked issues stay linked.`}
          onCancel={() => setModal(null)}
          onConfirm={() => revokeM.mutate()}
          pending={revokeM.isPending}
          title={`Disconnect ${adapter.name}?`}
        />
      )}
    </div>
  )
}

function ConnectionPill({
  connected,
  recentAction,
}: {
  connected: boolean
  recentAction: 'connected' | 'disconnected' | null
}) {
  if (recentAction === 'connected') {
    return (
      <span className="text-success font-mono text-[10px] tracking-[0.18em] uppercase">
        ✓ connected
      </span>
    )
  }
  if (recentAction === 'disconnected') {
    return (
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        ✓ disconnected
      </span>
    )
  }
  return (
    <span
      className={`font-mono text-[10px] tracking-[0.18em] uppercase ${
        connected ? 'text-success' : 'text-fg-muted'
      }`}
    >
      ● {connected ? 'connected' : 'not connected'}
    </span>
  )
}

function ConnectedSummary({ display }: { display: Record<string, null | string | undefined> }) {
  const entries = Object.entries(display).filter(([, v]) => v)
  if (entries.length === 0) return null
  return (
    <dl className="text-fg-muted mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
      {entries.map(([k, v]) => (
        <div className="contents" key={k}>
          <dt className="tracking-[0.05em]">{k}</dt>
          <dd className="text-fg-soft truncate">{String(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function ConnectModal({
  adapter,
  error,
  isExisting,
  onClose,
  onOAuthConnect,
  onSubmit,
  pending,
}: {
  adapter: AdapterDef
  error: unknown
  isExisting: boolean
  onClose: () => void
  /** Called when the operator clicks Connect on an OAuth-via mode. */
  onOAuthConnect: () => void
  onSubmit: (values: Record<string, unknown>) => void
  pending: boolean
}) {
  const hasModes = (adapter.modes ?? []).length > 0
  const [modeId, setModeId] = useState<string>(adapter.modes?.[0]?.id ?? '')
  const [values, setValues] = useState<Record<string, string>>({})
  const currentMode = adapter.modes?.find((m) => m.id === modeId)
  const currentFields = hasModes ? (currentMode?.fields ?? []) : adapter.fields
  const viaOAuth = currentMode?.viaOAuth === true

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }))

  const missing = currentFields.filter((f) => f.required && !(values[f.key] ?? '').trim())
  // OAuth modes don't gate the button on required fields — clicking
  // Connect kicks off the OAuth handshake before the operator has
  // anything to fill (e.g. project key for Jira lands after callback).
  const canSubmit = !pending && (viaOAuth || missing.length === 0)

  return (
    <div
      aria-modal
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
    >
      <div className="border-border bg-bg w-full max-w-md rounded-md border shadow-xl">
        <header className="border-border flex items-baseline justify-between border-b px-4 py-3">
          <h3 className="text-fg font-medium">
            {isExisting ? 'Reconnect' : 'Connect'} {adapter.name}
          </h3>
          <button
            aria-label="Close"
            className="text-fg-muted hover:text-fg"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </header>
        <form
          className="space-y-3 px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit) return
            if (viaOAuth) {
              onOAuthConnect()
              return
            }
            const body: Record<string, unknown> = {}
            for (const f of currentFields) {
              const v = (values[f.key] ?? '').trim()
              if (v) body[f.key] = v
            }
            if (hasModes && adapter.tagField) {
              body[adapter.tagField] = modeId
            }
            onSubmit(body)
          }}
        >
          {hasModes && (
            <ModeToggle
              modes={adapter.modes ?? []}
              onChange={(id) => {
                setModeId(id)
                setValues({})
              }}
              selected={modeId}
            />
          )}

          {currentFields.map((f) => (
            <label className="block" key={f.key}>
              <span className="text-fg-soft block text-[12px]">
                {f.label}
                {f.required ? '' : ' (optional)'}
              </span>
              {f.type === 'textarea' ? (
                <textarea
                  autoComplete="off"
                  className="border-border bg-bg-tertiary text-fg focus:border-accent t-sm mt-1 block w-full rounded border px-2 py-1.5 font-mono outline-none"
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder ?? ''}
                  rows={6}
                  spellCheck={false}
                  value={values[f.key] ?? ''}
                />
              ) : (
                <input
                  autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                  className="border-border bg-bg-tertiary text-fg focus:border-accent t-sm mt-1 block w-full rounded border px-2 py-1.5 outline-none"
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder ?? ''}
                  type={f.type}
                  value={values[f.key] ?? ''}
                />
              )}
              {f.hint && <span className="text-fg-muted mt-0.5 block text-[11px]">{f.hint}</span>}
            </label>
          ))}

          {error !== null && error !== undefined && (
            <ErrorBanner message={hintOf(error) ?? 'Failed to save. Check the values above.'} />
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              className="text-fg-muted hover:text-fg t-sm px-3 py-1.5"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="bg-accent text-bg t-sm rounded px-3 py-1.5 font-medium disabled:opacity-50"
              disabled={!canSubmit}
              type="submit"
            >
              {pending
                ? 'Saving…'
                : viaOAuth
                  ? `Continue with ${adapter.name}`
                  : isExisting
                    ? 'Reconnect'
                    : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModeToggle({
  modes,
  onChange,
  selected,
}: {
  modes: AdapterMode[]
  onChange: (id: string) => void
  selected: string
}) {
  return (
    <div className="border-border flex rounded border p-0.5">
      {modes.map((m) => {
        const active = m.id === selected
        return (
          <button
            className={`t-sm flex-1 rounded px-3 py-1 transition-colors ${
              active ? 'bg-accent text-bg font-medium' : 'text-fg-muted hover:text-fg'
            }`}
            key={m.id}
            onClick={() => onChange(m.id)}
            type="button"
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

function ConfirmDialog({
  confirmLabel,
  danger,
  error,
  message,
  onCancel,
  onConfirm,
  pending,
  title,
}: {
  confirmLabel: string
  danger?: boolean
  error: unknown
  message: string
  onCancel: () => void
  onConfirm: () => void
  pending: boolean
  title: string
}) {
  return (
    <div
      aria-modal
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
    >
      <div className="border-border bg-bg w-full max-w-md rounded-md border shadow-xl">
        <header className="border-border border-b px-4 py-3">
          <h3 className="text-fg font-medium">{title}</h3>
        </header>
        <div className="space-y-3 px-4 py-3">
          <p className="text-fg-soft text-[13px]">{message}</p>
          {error !== null && error !== undefined && (
            <ErrorBanner message={hintOf(error) ?? 'Failed. Try again or report to support.'} />
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              className="text-fg-muted hover:text-fg t-sm px-3 py-1.5"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className={`t-sm rounded px-3 py-1.5 font-medium disabled:opacity-50 ${
                danger ? 'bg-danger text-bg' : 'bg-accent text-bg'
              }`}
              disabled={pending}
              onClick={onConfirm}
              type="button"
            >
              {pending ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="border-danger/40 bg-danger/5 text-danger t-sm rounded border px-3 py-2">
      {message}
    </div>
  )
}

function ReadOnlyHint() {
  return (
    <div className="border-info/40 bg-info/5 text-info t-sm mb-3 rounded border px-3 py-2">
      You can view existing connections but only owners + admins can change them.
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          className="border-border bg-bg-tertiary/20 h-32 animate-pulse rounded-md border"
          key={i}
        />
      ))}
    </div>
  )
}

function hintOf(error: unknown): null | string {
  if (isStructuredError(error)) {
    const body = error.body
    return body.error.hint ?? body.error.message
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return null
}

// v1.4 W23 — Templates tab: list / create / edit / delete / apply.
//
// Mandatory UX checklist:
//   1. Entry point          → Templates tab on Integrations page
//   2. Empty state          → "No templates yet — create one below"
//   3. Loading state        → skeleton list row
//   4. Error state          → red banner with structured-error hint
//   5. Success feedback     → green "applied to <org>" pulse for 2s
//   6. Edit path            → edit button → modal with prefilled form
//   7. Delete path          → delete button → confirm dialog
//   8. No docs required     → header explains "save a configured
//                              integration and apply to another org"

function TemplatesTab() {
  const { orgs } = useOrg()
  const qc = useQueryClient()
  const templatesQ = useQuery({
    queryFn: adminApi.listIntegrationTemplates,
    queryKey: qk.integrationTemplates(),
  })
  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'edit'; row: IntegrationTemplateRow } | null
  >(null)
  const [confirmDelete, setConfirmDelete] = useState<IntegrationTemplateRow | null>(null)
  const [applyTarget, setApplyTarget] = useState<IntegrationTemplateRow | null>(null)
  const [recent, setRecent] = useState<{
    kind: 'applied' | 'created' | 'deleted'
    text: string
  } | null>(null)

  const deleteM = useMutation({
    mutationFn: (id: string) => adminApi.deleteIntegrationTemplate(id),
    onSuccess: (_data, id) => {
      const name = templatesQ.data?.find((t) => t.id === id)?.name ?? id
      setConfirmDelete(null)
      setRecent({ kind: 'deleted', text: `Deleted “${name}”.` })
      void qc.invalidateQueries({ queryKey: qk.integrationTemplates() })
      window.setTimeout(() => setRecent(null), 2000)
    },
  })

  return (
    <div className="space-y-3">
      <header className="flex items-baseline justify-between">
        <p className="text-fg-muted t-md max-w-prose">
          Save a configured integration and apply it to other orgs without redoing the OAuth
          handshake. Templates are private to you unless you mark one shared with an org.
        </p>
        <button
          className="border-accent/40 text-accent hover:bg-accent/10 t-sm rounded border px-3 py-1"
          onClick={() => setEditing({ mode: 'create' })}
          type="button"
        >
          New template
        </button>
      </header>

      {recent && (
        <div className="border-success/40 bg-success/5 text-success t-sm rounded border px-3 py-2">
          {recent.text}
        </div>
      )}

      {templatesQ.isLoading && (
        <ul className="divide-border/40 border-border divide-y border-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <li className="px-2 py-3" key={i}>
              <div className="bg-fg-muted/10 h-4 w-1/2 animate-pulse rounded" />
            </li>
          ))}
        </ul>
      )}

      {templatesQ.error && (
        <ErrorBanner message={hintOf(templatesQ.error) ?? 'Failed to load templates.'} />
      )}

      {templatesQ.data && templatesQ.data.length === 0 && (
        <p className="text-fg-muted border-border border-y py-6 text-center text-[12px]">
          No templates yet. Configure an integration first, then come back to save a template.
        </p>
      )}

      {templatesQ.data && templatesQ.data.length > 0 && (
        <ul className="divide-border/40 border-border divide-y border-y">
          {templatesQ.data.map((t) => (
            <li className="flex items-baseline gap-3 px-2 py-3" key={t.id}>
              <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
                {t.kind}
              </span>
              <span className="text-fg flex-1 truncate text-[13px]">{t.name}</span>
              {t.sharedWithOrgSlug ? (
                <span className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
                  shared · {t.sharedWithOrgSlug}
                </span>
              ) : (
                <span className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
                  private
                </span>
              )}
              <button
                className="text-accent border-accent/40 hover:bg-accent/10 t-sm rounded border px-2 py-0.5"
                onClick={() => setApplyTarget(t)}
                type="button"
              >
                Apply
              </button>
              <button
                className="text-fg border-rule hover:bg-fg-muted/5 t-sm rounded border px-2 py-0.5"
                onClick={() => setEditing({ mode: 'edit', row: t })}
                type="button"
              >
                Edit
              </button>
              <button
                className="text-danger border-danger/50 hover:bg-danger/10 t-sm rounded border px-2 py-0.5"
                onClick={() => setConfirmDelete(t)}
                type="button"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TemplateEditor
          initial={editing.mode === 'edit' ? editing.row : null}
          onClose={() => setEditing(null)}
          onSaved={(action) => {
            setEditing(null)
            setRecent({ kind: 'created', text: `${action} template saved.` })
            window.setTimeout(() => setRecent(null), 2000)
          }}
          shareableOrgs={orgs.filter((o) => o.role === 'owner' || o.role === 'admin')}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          confirmLabel="Delete"
          error={deleteM.error}
          message={`Delete template “${confirmDelete.name}”? Already-applied integrations are unaffected.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteM.mutate(confirmDelete.id)}
          pending={deleteM.isPending}
          title="Delete template"
        />
      )}

      {applyTarget && (
        <ApplyTemplateModal
          onClose={() => setApplyTarget(null)}
          onSuccess={(slug) => {
            setApplyTarget(null)
            setRecent({ kind: 'applied', text: `Applied “${applyTarget.name}” to ${slug}.` })
            window.setTimeout(() => setRecent(null), 2000)
          }}
          targetOrgs={orgs.filter((o) => o.role === 'owner' || o.role === 'admin')}
          template={applyTarget}
        />
      )}
    </div>
  )
}

function TemplateEditor({
  initial,
  onClose,
  onSaved,
  shareableOrgs,
}: {
  initial: IntegrationTemplateRow | null
  onClose: () => void
  onSaved: (action: 'Created' | 'Updated') => void
  shareableOrgs: Array<{ role: string; slug: string; name: string }>
}) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<IntegrationKind>(initial?.kind ?? 'github')
  const [name, setName] = useState(initial?.name ?? '')
  const [configText, setConfigText] = useState(
    initial ? JSON.stringify(initial.config, null, 2) : '{\n  \n}'
  )
  const [shareSlug, setShareSlug] = useState<string>(initial?.sharedWithOrgSlug ?? '')
  const [error, setError] = useState<null | string>(null)

  const saveM = useMutation({
    mutationFn: async () => {
      let config: Record<string, unknown>
      try {
        config = JSON.parse(configText)
      } catch {
        throw new Error('config must be valid JSON')
      }
      const body = {
        config,
        kind,
        name,
        sharedWithOrgSlug: shareSlug || null,
      }
      return initial
        ? adminApi.updateIntegrationTemplate(initial.id, body)
        : adminApi.createIntegrationTemplate(body)
    },
    onError: (e) => setError(hintOf(e) ?? 'Failed to save template.'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.integrationTemplates() })
      onSaved(initial ? 'Updated' : 'Created')
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-bg border-border w-full max-w-xl rounded border p-4 shadow-lg">
        <header className="mb-3 flex items-baseline justify-between">
          <h3 className="text-fg text-[15px] font-semibold">
            {initial ? 'Edit template' : 'New template'}
          </h3>
          <button className="text-fg-muted hover:text-fg t-sm" onClick={onClose} type="button">
            Close
          </button>
        </header>
        <div className="space-y-3">
          <label className="block">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.16em] uppercase">
              Kind
            </span>
            <select
              className="border-rule bg-bg mt-1 w-full rounded border px-2 py-1 text-[13px]"
              onChange={(e) => setKind(e.target.value as IntegrationKind)}
              value={kind}
            >
              {(['github', 'gitlab', 'jira', 'linear', 'slack'] satisfies IntegrationKind[]).map(
                (k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                )
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.16em] uppercase">
              Name
            </span>
            <input
              className="border-rule bg-bg mt-1 w-full rounded border px-2 py-1 text-[13px]"
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GitHub for our main org"
              value={name}
            />
          </label>
          <label className="block">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.16em] uppercase">
              Config (JSON)
            </span>
            <textarea
              className="border-rule bg-bg mt-1 w-full rounded border px-2 py-1 font-mono text-[12px]"
              onChange={(e) => setConfigText(e.target.value)}
              rows={8}
              value={configText}
            />
          </label>
          <label className="block">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.16em] uppercase">
              Share with org (optional)
            </span>
            <select
              className="border-rule bg-bg mt-1 w-full rounded border px-2 py-1 text-[13px]"
              onChange={(e) => setShareSlug(e.target.value)}
              value={shareSlug}
            >
              <option value="">— private —</option>
              {shareableOrgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name} ({o.slug})
                </option>
              ))}
            </select>
          </label>
          {error && <ErrorBanner message={error} />}
        </div>
        <footer className="mt-4 flex justify-end gap-2">
          <button
            className="text-fg-muted hover:text-fg t-sm border-border rounded border px-3 py-1"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="text-accent border-accent/40 hover:bg-accent/10 t-sm rounded border px-3 py-1"
            disabled={saveM.isPending || !name.trim()}
            onClick={() => {
              setError(null)
              saveM.mutate()
            }}
            type="button"
          >
            {saveM.isPending ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function ApplyTemplateModal({
  onClose,
  onSuccess,
  targetOrgs,
  template,
}: {
  onClose: () => void
  onSuccess: (slug: string) => void
  targetOrgs: Array<{ role: string; slug: string; name: string }>
  template: IntegrationTemplateRow
}) {
  const [slug, setSlug] = useState(targetOrgs[0]?.slug ?? '')
  const [error, setError] = useState<null | string>(null)
  const qc = useQueryClient()
  const applyM = useMutation({
    mutationFn: () => adminApi.applyIntegrationTemplate(template.id, slug),
    onError: (e) => setError(hintOf(e) ?? 'Apply failed.'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.integrations() })
      onSuccess(slug)
    },
  })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-bg border-border w-full max-w-md rounded border p-4 shadow-lg">
        <header className="mb-3">
          <h3 className="text-fg text-[15px] font-semibold">Apply template</h3>
          <p className="text-fg-muted t-sm mt-1">
            “{template.name}” ({template.kind}) → choose the org to apply to. This runs the same
            configure step the integrations page would, against the target org.
          </p>
        </header>
        <label className="block">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.16em] uppercase">
            Target org
          </span>
          <select
            className="border-rule bg-bg mt-1 w-full rounded border px-2 py-1 text-[13px]"
            onChange={(e) => setSlug(e.target.value)}
            value={slug}
          >
            {targetOrgs.length === 0 && <option value="">— no orgs you admin —</option>}
            {targetOrgs.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name} ({o.slug})
              </option>
            ))}
          </select>
        </label>
        {error && <ErrorBanner message={error} />}
        <footer className="mt-4 flex justify-end gap-2">
          <button
            className="text-fg-muted hover:text-fg t-sm border-border rounded border px-3 py-1"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="text-accent border-accent/40 hover:bg-accent/10 t-sm rounded border px-3 py-1"
            disabled={applyM.isPending || !slug}
            onClick={() => {
              setError(null)
              applyM.mutate()
            }}
            type="button"
          >
            {applyM.isPending ? 'Applying…' : 'Apply'}
          </button>
        </footer>
      </div>
    </div>
  )
}
