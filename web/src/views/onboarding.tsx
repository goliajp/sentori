import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import {
  adminApi,
  type OrgRow,
  orgsApi,
  type ProjectRow,
  projectsApi,
  tokensApi,
} from '@/api/client'
import { useAuth } from '@/auth/state'

type Phase = 'create-org' | 'create-project' | 'install-sdk' | 'wait-event'

/**
 * Phase 14 sub-B: 4-step onboarding wizard.
 *
 *   create-org    — only when the user has no memberships at all
 *                   (the server's email-verify path bootstraps a personal
 *                   org, so most users skip this step).
 *   create-project — name + auto-generated default token, raw token kept
 *                    in component state to feed the next step.
 *   install-sdk    — show ingestUrl + raw token + RN install snippet,
 *                    "I've installed it" advances.
 *   wait-event     — poll listIssues every 3 s; first issue ⇒ navigate
 *                    to /org/{slug}/issues.
 *
 * Phase is mostly derived from server state (orgs / projects), with a
 * local override to advance manually for the SDK / wait steps where the
 * server has no opinion on whether the user "is done".
 */
export function OnboardingView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { logout } = useAuth()
  const [override, setOverride] = useState<null | Phase>(null)
  const [tokenInfo, setTokenInfo] = useState<{ projectId: string; rawToken: string } | null>(null)

  const orgsQuery = useQuery({ queryFn: orgsApi.listMine, queryKey: ['orgs'] })
  const projectsQuery = useQuery({
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })

  if (orgsQuery.isLoading || projectsQuery.isLoading) return <CenteredSpinner />

  const orgs = orgsQuery.data ?? []
  const firstOrg: null | OrgRow = orgs[0] ?? null
  const orgProjects: ProjectRow[] = firstOrg
    ? (projectsQuery.data ?? []).filter((p) => p.orgSlug === firstOrg.slug)
    : []
  const firstProject: null | ProjectRow = orgProjects[0] ?? null

  const phase: Phase = override ?? derivePhase(firstOrg, firstProject)

  const skipToDashboard = () => {
    if (firstOrg) navigate(`/org/${firstOrg.slug}/issues`)
  }

  return (
    <Shell skip={firstOrg ? skipToDashboard : null} signOut={() => void logout()}>
      <Stepper phase={phase} />
      {phase === 'create-org' && (
        <CreateOrgStep onDone={() => void queryClient.invalidateQueries({ queryKey: ['orgs'] })} />
      )}
      {phase === 'create-project' && firstOrg && (
        <CreateProjectStep
          onDone={(info) => {
            setTokenInfo(info)
            setOverride('install-sdk')
            void queryClient.invalidateQueries({ queryKey: ['projects'] })
          }}
          org={firstOrg}
        />
      )}
      {phase === 'install-sdk' && firstOrg && firstProject && (
        <InstallSdkStep
          onDone={() => setOverride('wait-event')}
          project={firstProject}
          tokenInfo={tokenInfo}
        />
      )}
      {phase === 'wait-event' && firstOrg && firstProject && (
        <WaitEventStep
          onDone={() => navigate(`/org/${firstOrg.slug}/issues`)}
          project={firstProject}
          tokenInfo={tokenInfo}
        />
      )}
    </Shell>
  )
}

function derivePhase(org: null | OrgRow, project: null | ProjectRow): Phase {
  if (!org) return 'create-org'
  if (!project) return 'create-project'
  return 'install-sdk'
}

// ---------- shell + stepper ----------

function Shell({
  children,
  signOut,
  skip,
}: {
  children: ReactNode
  signOut: () => void
  skip: (() => void) | null
}) {
  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <div className="border-border bg-bg w-[34rem] space-y-6 rounded-lg border p-6">
        {children}
        <div className="border-border/40 flex items-center justify-between border-t pt-4">
          <button className="text-fg-muted hover:text-fg text-xs" onClick={signOut} type="button">
            Sign out
          </button>
          {skip && (
            <button className="text-fg-muted hover:text-fg text-xs" onClick={skip} type="button">
              Skip to dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stepper({ phase }: { phase: Phase }) {
  const steps: { key: Phase; label: string }[] = [
    { key: 'create-org', label: 'Org' },
    { key: 'create-project', label: 'Project' },
    { key: 'install-sdk', label: 'Install SDK' },
    { key: 'wait-event', label: 'First event' },
  ]
  const currentIdx = steps.findIndex((s) => s.key === phase)
  return (
    <div className="text-fg-muted flex items-center gap-2 t-sm tracking-wider uppercase">
      {steps.map((s, i) => (
        <div className="flex items-center gap-2" key={s.key}>
          <span
            className={
              i === currentIdx ? 'text-accent' : i < currentIdx ? 'text-fg' : 'text-fg-muted'
            }
          >
            {i + 1}. {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-fg-muted">›</span>}
        </div>
      ))}
    </div>
  )
}

// ---------- step 1: create org (rare, only when no memberships) ----------

function CreateOrgStep({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const initial = user?.email ? slugCandidate(user.email) : ''
  const [name, setName] = useState(initial)
  const [slug, setSlug] = useState(initial)
  const [error, setError] = useState<null | string>(null)

  const create = useMutation({
    mutationFn: () => orgsApi.create(slug.trim(), name.trim()),
    onError: (err: { body?: { error?: string }; status?: number }) => {
      const code = err.body?.error
      if (code === 'invalidSlug') setError('Slug must be 3–32 chars: a-z, 0-9, hyphen.')
      else if (code === 'invalidName') setError('Name is required (1–64 chars).')
      else if (code === 'slugTaken' || err.status === 409)
        setError('That slug is already taken — try another.')
      else setError('Could not create org.')
    },
    onSuccess: () => onDone(),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    create.mutate()
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div>
        <h1 className="text-fg text-lg font-semibold">Create your organization</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Signed in as <span className="text-fg font-mono">{user?.email}</span>.
        </p>
      </div>
      <Field label="Name">
        <input
          autoFocus
          className={inputCls}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc"
          required
          value={name}
        />
      </Field>
      <Field hint={`sentori.golia.jp/org/${slug || '...'}`} label="Slug">
        <input
          className={inputCls}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          pattern="[a-z0-9-]{3,32}"
          placeholder="acme"
          required
          value={slug}
        />
      </Field>
      {error && <p className="text-sm text-[color:var(--color-danger)]">{error}</p>}
      <PrimaryButton disabled={create.isPending || !name.trim() || slug.length < 3}>
        {create.isPending ? 'Creating…' : 'Continue'}
      </PrimaryButton>
    </form>
  )
}

// ---------- step 2: create project + auto-generate default token ----------

function CreateProjectStep({
  onDone,
  org,
}: {
  onDone: (info: { projectId: string; rawToken: string }) => void
  org: OrgRow
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState<null | string>(null)

  const create = useMutation({
    mutationFn: async () => {
      const project = await projectsApi.create(org.slug, name.trim())
      const token = await tokensApi.create(project.id, {
        kind: 'public',
        label: 'default',
      })
      return { projectId: project.id, rawToken: token.token }
    },
    onError: () => setError('Could not create project.'),
    onSuccess: (info) => onDone(info),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    create.mutate()
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div>
        <h1 className="text-fg text-lg font-semibold">Create your first project</h1>
        <p className="text-fg-muted mt-1 text-sm">
          A project groups events from one app. We'll generate a public token for you in the next
          step.
        </p>
      </div>
      <Field label="Project name">
        <input
          autoFocus
          className={inputCls}
          onChange={(e) => setName(e.target.value)}
          placeholder="myapp-ios"
          required
          value={name}
        />
      </Field>
      {error && <p className="text-sm text-[color:var(--color-danger)]">{error}</p>}
      <PrimaryButton disabled={create.isPending || !name.trim()}>
        {create.isPending ? 'Creating…' : 'Create project'}
      </PrimaryButton>
    </form>
  )
}

// ---------- step 3: install SDK ----------

function InstallSdkStep({
  onDone,
  project,
  tokenInfo,
}: {
  onDone: () => void
  project: ProjectRow
  tokenInfo: { projectId: string; rawToken: string } | null
}) {
  const ingestUrl = window.location.origin
  const [sdk, setSdk] = useState<SdkChoice>('react')

  // If the user reloaded the page or got here without a freshly-minted
  // token (rare — they'd have to navigate manually), prompt them to
  // create one in project settings rather than minting a second silently.
  if (!tokenInfo || tokenInfo.projectId !== project.id) {
    return (
      <div className="space-y-4">
        <h1 className="text-fg text-lg font-semibold">Install the SDK</h1>
        <p className="text-fg-muted text-sm">
          Token isn't visible here — it's shown once at create time. Create a fresh token in project
          settings to continue.
        </p>
        <PrimaryButton onClick={onDone}>I'll do that — continue</PrimaryButton>
      </div>
    )
  }

  const current = sdkSnippets({
    project,
    rawToken: tokenInfo.rawToken,
    ingestUrl,
  })[sdk]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-fg text-lg font-semibold">Install the SDK</h1>
        <p className="text-fg-muted mt-1 text-sm">
          One-time token reveal — copy it now and store it somewhere safe.
        </p>
      </div>

      <SdkPicker value={sdk} onChange={setSdk} />

      <CodeBlock label="Public token">{tokenInfo.rawToken}</CodeBlock>
      <CodeBlock label="Install">{current.install}</CodeBlock>
      <CodeBlock label="Initialize">{current.init}</CodeBlock>

      <PrimaryButton onClick={onDone}>I've installed it</PrimaryButton>
    </div>
  )
}

// ---------- step 4: wait for first event ----------

function WaitEventStep({
  onDone,
  project,
  tokenInfo,
}: {
  onDone: () => void
  project: ProjectRow
  tokenInfo: { projectId: string; rawToken: string } | null
}) {
  const issuesQuery = useQuery({
    // `status:'any'` so a freshly captured issue counts even if the
    // user has flipped through statuses (e.g. resolved the smoke-test
    // error before returning here). The server defaults to 'active'.
    queryFn: () => adminApi.listIssues(project.id, { limit: 1, status: 'any' }),
    queryKey: ['issues', project.id, 'wait-onboarding'],
    refetchInterval: 3000,
  })

  useEffect(() => {
    if ((issuesQuery.data?.length ?? 0) > 0) onDone()
  }, [issuesQuery.data, onDone])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-fg text-lg font-semibold">Waiting for your first event…</h1>
        <p className="text-fg-muted mt-1 text-sm leading-relaxed">
          Trigger an error in your app — we'll auto-redirect to the dashboard the moment one
          arrives. Polling every 3 seconds.
        </p>
      </div>
      <div className="border-border/60 bg-bg-tertiary/40 rounded-md border p-4 t-md">
        <div className="text-fg-muted mb-1 tracking-wider uppercase">Quick-test snippet (JS)</div>
        <pre className="text-fg overflow-x-auto font-mono t-sm leading-relaxed">
          {`import { captureError } from '@goliapkg/sentori-react-native'
captureError(new Error('hello from ${project.name}'))`}
        </pre>
      </div>
      {tokenInfo && (
        <details className="text-fg-muted text-xs">
          <summary className="cursor-pointer">Forgot the token?</summary>
          <code className="text-fg mt-2 block font-mono">{tokenInfo.rawToken}</code>
        </details>
      )}
      <button className="text-fg-muted hover:text-fg text-xs" onClick={onDone} type="button">
        Skip — I'll send one later
      </button>
    </div>
  )
}

// ---------- SDK choice (Phase 17 sub-C / Phase 21 sub-F) ----------

type SdkChoice = 'expo' | 'javascript' | 'next' | 'react' | 'react-native'

const SDKS: { description: string; key: SdkChoice; label: string }[] = [
  { key: 'react', label: 'React', description: 'Browser SPA / CRA' },
  { key: 'next', label: 'Next.js', description: 'App Router ≥ 14' },
  { key: 'expo', label: 'Expo', description: 'Managed RN workflow' },
  { key: 'react-native', label: 'React Native', description: 'Bare RN / non-Expo' },
  { key: 'javascript', label: 'JavaScript', description: 'Browser / Node, no framework' },
]

function SdkPicker({ onChange, value }: { onChange: (s: SdkChoice) => void; value: SdkChoice }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {SDKS.map((s) => (
        <button
          aria-pressed={value === s.key}
          className={`rounded-md border px-3 py-2 text-left t-md transition-colors ${
            value === s.key ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-tertiary'
          }`}
          key={s.key}
          onClick={() => onChange(s.key)}
          type="button"
        >
          <div className="text-fg font-medium">{s.label}</div>
          <div className="text-fg-muted">{s.description}</div>
        </button>
      ))}
    </div>
  )
}

function sdkSnippets({
  ingestUrl,
  project,
  rawToken,
}: {
  ingestUrl: string
  project: ProjectRow
  rawToken: string
}): Record<SdkChoice, { init: string; install: string }> {
  const release = `${project.name}@1.0.0+1`
  return {
    react: {
      install: `npm install @goliapkg/sentori-react @goliapkg/sentori-javascript`,
      init: `// main.tsx
import { SentoriProvider } from '@goliapkg/sentori-react'
import { createRoot } from 'react-dom/client'
import App from './App'

const config = {
  token: '${rawToken}',
  ingestUrl: '${ingestUrl}',
  release: '${release}',
  environment: 'prod',
}

createRoot(document.getElementById('root')!).render(
  <SentoriProvider config={config}>
    <App />
  </SentoriProvider>,
)`,
    },
    next: {
      install: `npm install @goliapkg/sentori-next`,
      init: `// instrumentation.ts (project root)
export { register, onRequestError } from '@goliapkg/sentori-next/instrumentation'

// .env.local
NEXT_PUBLIC_SENTORI_TOKEN=${rawToken}
NEXT_PUBLIC_SENTORI_INGEST_URL=${ingestUrl}
NEXT_PUBLIC_SENTORI_RELEASE=${release}
NEXT_PUBLIC_SENTORI_ENVIRONMENT=prod

// app/layout.tsx (top of file, before the default export)
'use client'
import { clientInit } from '@goliapkg/sentori-next/client'
clientInit()`,
    },
    expo: {
      install: `bunx expo install @goliapkg/sentori-expo @goliapkg/sentori-react-native expo-application`,
      init: `// app.json — add to plugins array
{
  "expo": {
    "plugins": ["@goliapkg/sentori-expo"]
  }
}

// App.tsx
import * as Application from 'expo-application'
import { initSentoriExpo } from '@goliapkg/sentori-expo'

initSentoriExpo({
  application: Application,
  token: '${rawToken}',
  ingestUrl: '${ingestUrl}',
  // release auto-derived from expo-application
})`,
    },
    'react-native': {
      install: `npm install @goliapkg/sentori-react-native`,
      init: `// App.tsx
import { initSentori } from '@goliapkg/sentori-react-native'

initSentori({
  token: '${rawToken}',
  ingestUrl: '${ingestUrl}',
  release: '${release}',
  environment: 'prod',
})`,
    },
    javascript: {
      install: `npm install @goliapkg/sentori-javascript`,
      init: `// Browser or Node — same import.
import { initSentori } from '@goliapkg/sentori-javascript'

initSentori({
  token: '${rawToken}',
  ingestUrl: '${ingestUrl}',
  release: '${release}',
  environment: 'prod',
})`,
    },
  }
}

// ---------- shared atoms ----------

const inputCls =
  'border-border bg-bg-tertiary text-fg focus:ring-accent w-full rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none'

function Field({ children, hint, label }: { children: ReactNode; hint?: string; label: string }) {
  return (
    <label className="block">
      <span className="text-fg-muted text-xs tracking-wider uppercase">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-fg-muted mt-1 block font-mono t-sm">{hint}</span>}
    </label>
  )
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className="bg-accent text-bg w-full rounded-md px-3 py-2 text-sm disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type={onClick ? 'button' : 'submit'}
    >
      {children}
    </button>
  )
}

function CodeBlock({ children, label }: { children: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    void navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="border-border/60 bg-bg-tertiary/40 rounded-md border">
      <div className="border-border/60 flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-fg-muted t-sm tracking-wider uppercase">{label}</span>
        <button className="text-fg-muted hover:text-fg t-sm" onClick={onCopy} type="button">
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="text-fg overflow-x-auto px-3 py-2 font-mono t-md leading-relaxed whitespace-pre">
        {children}
      </pre>
    </div>
  )
}

function CenteredSpinner() {
  return (
    <div className="text-fg-muted flex h-full items-center justify-center text-sm">Loading…</div>
  )
}

function slugCandidate(email: string): string {
  const local = email.split('@')[0] ?? ''
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
  return cleaned.length >= 3 ? cleaned : `user-${Math.random().toString(36).slice(2, 8)}`
}
