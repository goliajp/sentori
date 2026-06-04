import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { tokensApi, type TokenRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { Hint } from '@/components/Hint'
import { PageHeader } from '@/layout/page-header'
import { qk } from '@/api/query-keys'

/**
 * Integration module — sidebar entry. Project comes from the org-wide
 * sidebar context (set by the `?project=` switcher), same as every
 * other per-project module, so we never duplicate the project in
 * the URL path.
 *
 * Three stacked sections:
 *
 *   ── Project ─────  static info (name, id, org)
 *   ── Tokens ──────  list / create / revoke ingest tokens
 *   ── Quickstart ──  ready-to-paste SDK install + init snippet,
 *                     auto-substituted with the most recent
 *                     unrevoked public token (or a placeholder if
 *                     none have been minted yet)
 *
 * Token creation reveals the raw secret exactly once in a top-of-list
 * card (mirroring the GitHub PAT UX). The list itself only stores
 * label + last4 + created_at, because `tokens` rows only retain a
 * SHA-256 hash server-side.
 */
export function ProjectIntegrationView() {
  const { currentOrg, currentProject } = useOrg()
  const qc = useQueryClient()

  const projectId = currentProject?.id ?? null
  const project = currentProject

  const tokensQ = useQuery({
    enabled: !!projectId,
    queryFn: () => tokensApi.list(projectId!),
    queryKey: qk.tokens(projectId),
  })
  const tokens = (tokensQ.data ?? []).filter((t) => !t.revokedAt)

  const [justMinted, setJustMinted] = useState<{ secret: string; tokenId: string } | null>(null)
  const [label, setLabel] = useState('')

  const createM = useMutation({
    mutationFn: () =>
      tokensApi.create(projectId!, { kind: 'public', label: label.trim() || undefined }),
    onSuccess: (r) => {
      setJustMinted({ secret: r.token, tokenId: r.id })
      setLabel('')
      void qc.invalidateQueries({ queryKey: qk.tokens(projectId) })
    },
  })

  const revokeM = useMutation({
    mutationFn: (tokenId: string) => tokensApi.revoke(projectId!, tokenId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.tokens(projectId) }),
  })

  if (!projectId) {
    return (
      <div className="">
        <PageHeader subtitle="install · ingest tokens" title="Integrate" />
        <p className="border-border text-fg-secondary border-y py-4 text-[13px]">
          Pick a project in the sidebar to mint an ingest token and grab the SDK quickstart snippet.
        </p>
      </div>
    )
  }

  return (
    <div className="">
      <PageHeader subtitle={`${project?.name ?? '—'} · ${currentOrg.slug}`} title="Integrate" />

      <section>
        <header className="sec-head">
          <span className="sec-head-title">Project</span>
          <span className="sec-head-sub">stable identifiers</span>
        </header>
        <div className="border-border border-y py-2">
          <RoRow label="name" value={project?.name ?? '—'} />
          <RoRow label="project id" value={projectId} mono />
          <RoRow label="org" value={currentOrg.slug} mono />
        </div>
      </section>

      {/* ── Tokens ── */}
      <section className="mt-8">
        <header className="sec-head">
          <span className="sec-head-title">Ingest tokens</span>
          <span className="sec-head-sub">
            {tokensQ.isLoading ? 'loading…' : `${tokens.length} active`}
          </span>
        </header>

        {justMinted && (
          <div className="border-accent bg-accent/10 mb-4 border px-4 py-3">
            <div className="text-accent-hover mb-1 font-mono text-[10px] tracking-[0.18em] uppercase">
              New token — copy now, this is the only time it&apos;s shown
            </div>
            <code className="text-fg block font-mono text-[13px] break-all select-all">
              {justMinted.secret}
            </code>
            <button
              className="text-fg-muted hover:text-accent mt-2 font-mono text-[10px] tracking-[0.12em] uppercase"
              onClick={() => setJustMinted(null)}
              type="button"
            >
              dismiss ✕
            </button>
          </div>
        )}

        <form
          className="border-border mb-4 flex items-end gap-2 border-y py-3"
          onSubmit={(e) => {
            e.preventDefault()
            createM.mutate()
          }}
        >
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              label (optional)
            </span>
            <input
              className="border-border bg-bg-secondary text-fg placeholder:text-fg-muted focus:border-accent h-7 border px-2 font-mono text-[12px] focus:outline-none"
              onChange={(e) => setLabel(e.target.value)}
              placeholder="insight-prod"
              value={label}
            />
          </label>
          <button
            className="bg-accent text-bg inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={createM.isPending}
            type="submit"
          >
            {createM.isPending ? 'creating…' : '+ mint token'}
          </button>
        </form>

        {tokensQ.isLoading && <Hint>Loading tokens…</Hint>}
        {!tokensQ.isLoading && tokens.length === 0 && (
          <Hint>No active tokens yet. Mint one above to start receiving events.</Hint>
        )}
        {tokens.length > 0 && (
          <table className="bench">
            <thead>
              <tr>
                <th>label</th>
                <th>kind</th>
                <th>last 4</th>
                <th>created</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td className="lead">{t.label ?? <em>(unlabeled)</em>}</td>
                  <td className="text-fg-secondary font-mono">{t.kind}</td>
                  <td className="text-fg-secondary font-mono">
                    {t.last4 ? `••••${t.last4}` : '—'}
                  </td>
                  <td className="text-fg-secondary font-mono text-[11px]">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <button
                      className="text-fg-muted hover:text-danger font-mono text-[10px] tracking-[0.1em] uppercase disabled:opacity-40"
                      disabled={revokeM.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `Revoke ${t.label ?? 'this token'}? In-flight events will reject.`
                          )
                        ) {
                          revokeM.mutate(t.id)
                        }
                      }}
                      type="button"
                    >
                      revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Quickstart ── */}
      <Quickstart latestSecret={justMinted?.secret ?? null} sampleToken={tokens[0] ?? null} />

      <p className="text-fg-muted mt-6 font-mono text-[10px] tracking-[0.12em] uppercase">
        Once events arrive,{' '}
        <Link
          className="text-fg hover:text-accent"
          to={`/main/org/${currentOrg.slug}/issues?project=${projectId}`}
        >
          open issues →
        </Link>
      </p>
    </div>
  )
}

function Quickstart({
  latestSecret,
  sampleToken,
}: {
  latestSecret: null | string
  sampleToken: null | TokenRow
}) {
  const tokenForSnippet = latestSecret
    ? latestSecret
    : sampleToken
      ? `st_pk_…${sampleToken.last4 ?? '????'}  // grab the secret when you minted this token`
      : 'st_pk_paste_token_here'

  const install = `bun add @goliapkg/sentori-react-native`
  const init = `import * as Sentori from '@goliapkg/sentori-react-native'

Sentori.init({
  token: '${tokenForSnippet}',
  release: 'your-app@1.0.0+1',
  environment: __DEV__ ? 'dev' : 'prod',
})`

  return (
    <section className="mt-8">
      <header className="sec-head">
        <span className="sec-head-title">React Native quickstart</span>
        <span className="sec-head-sub">copy + paste, two files</span>
      </header>
      <div className="border-border border-y py-4">
        <SnippetBlock label="install" code={install} />
        <SnippetBlock label="init (App.tsx / index.ts entry)" code={init} />
      </div>
      <p className="text-fg-secondary mt-3 max-w-prose text-[12px]">
        Default ingest endpoint is <code>https://ingest.sentori.golia.jp</code>. Override with{' '}
        <code>ingestUrl</code> on the init options if you self-host. The init call is idempotent —
        safe to import at the top of the entry module.
      </p>
    </section>
  )
}

function SnippetBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — user can still select manually */
    }
  }
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          {label}
        </span>
        <button
          className="text-fg-muted hover:text-accent font-mono text-[10px] tracking-[0.12em] uppercase"
          onClick={() => void copy()}
          type="button"
        >
          {copied ? 'copied ✓' : 'copy'}
        </button>
      </div>
      <pre className="border-border bg-bg-secondary text-fg overflow-x-auto border px-3 py-2 font-mono text-[12px] leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

function RoRow({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-3 py-1.5">
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        {label}
      </span>
      <span className={`text-fg text-[13px] break-all ${mono ? 'font-mono text-[12px]' : ''}`}>
        {value}
      </span>
    </div>
  )
}
