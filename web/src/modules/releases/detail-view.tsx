// v2.2 — release detail rebuilt under the find-bug lens.
//
// Pre-v2.2: this page showed sourcemap / dSYM / proguard / source-
// bundle artifacts. That's the "engineering hygiene" lens — moved
// to a secondary section at the bottom. The primary panel now
// answers the deploy-day question:
//
//   "What's broken / what got fixed in release X?"
//
// Data fetch goes through the v2.2 `/explore` endpoint with
// `dim=issue` + `releaseEq=<thisRelease>` — same shape an LLM agent
// would call. UI is a consumer of the API, not a separate path.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import {
  adminApi,
  type ExploreMeasure,
  type ExploreReq,
  type ExploreResp,
  type ExploreRow,
  isStructuredError,
  type ReleaseListRow,
  type ReleaseSourcemap,
} from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { Stat } from '@/components/Stat'
import { RowSkeleton } from '@/components/Skeleton'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

const ISSUE_MEASURES: ExploreMeasure[] = ['event_count', 'unique_users', 'first_seen', 'last_seen']

export function ReleaseDetailView() {
  const { currentOrg, currentProject } = useOrg()
  const params = useParams<{ release: string }>()
  const release = params.release ? decodeURIComponent(params.release) : ''
  const projectId = currentProject?.id ?? null

  // Primary: issues in this release (find-bug lens).
  const issuesReq: ExploreReq = {
    dim: 'issue',
    measures: ISSUE_MEASURES,
    filters: { releaseEq: release },
    orderBy: 'event_count',
    orderDir: 'desc',
    limit: 200,
  }
  const issuesQ = useQuery<ExploreResp>({
    enabled: !!projectId && !!release,
    queryFn: () => adminApi.explore(projectId!, issuesReq),
    queryKey: ['explore', 'release-issues', projectId, release],
  })

  // Secondary: engineering hygiene (sourcemap / dSYM / proguard / source bundles).
  const artifactsQ = useQuery({
    enabled: !!projectId && !!release,
    queryFn: () => adminApi.releaseArtifacts(projectId!, release),
    queryKey: qk.releaseArtifacts(projectId, release),
  })

  // v2.4 — release-level KPI (events / affected users) via the admin
  // releases listing. Cached per project; multiple release-detail pages
  // share a single fetch within the TTL.
  const releasesQ = useQuery<ReleaseListRow[]>({
    enabled: !!projectId,
    queryFn: () => adminApi.listReleases(projectId!, { limit: 500 }),
    queryKey: qk.releases(projectId),
    staleTime: 60_000,
  })
  const currentRelease = releasesQ.data?.find((r) => r.name === release)

  const issueRows = issuesQ.data?.rows ?? []
  const issuesByStatus = groupByStatus(issueRows)

  return (
    <div className="sentori-page-in">
      <PageHeader count={issueRows.length} subtitle={release || '—'} title="Release" />

      <Link
        className="mb-4 inline-block font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
        to={`/main/org/${currentOrg.slug}/releases`}
      >
        ← all releases
      </Link>

      {/* v2.4 — release-level KPI band. Mirrors the Users overview's
       *  three-stat editorial bar; gives operators a fast read on
       *  "how bad is this release" before they drill into issues. */}
      {currentRelease && (
        <section
          aria-label="release-kpi"
          className="mb-8 grid grid-cols-1 border-y border-[color:var(--rule)] sm:grid-cols-3"
        >
          <Stat
            label="events"
            sub="ingested under this release"
            value={currentRelease.eventCount.toLocaleString()}
          />
          <Stat
            highlight={currentRelease.affectedUsers > 0}
            label="affected users"
            sub="distinct identity fingerprints"
            value={currentRelease.affectedUsers.toLocaleString()}
          />
          <Stat
            label="last seen"
            sub={
              currentRelease.firstSeen ? `first ${formatRelative(currentRelease.firstSeen)}` : '—'
            }
            value={currentRelease.lastSeen ? formatRelative(currentRelease.lastSeen) : '—'}
          />
        </section>
      )}

      {/* ── PRIMARY: find-bug lens — summary + deep link to Issues ──
       *
       * v2.2 architecture: Issues is THE list view. Release Detail
       * doesn't re-render the same table; it summarises and links
       * into Issues with the release pre-filtered. Single source
       * of truth for issue rendering, single navigation pattern,
       * URL is shareable. */}
      <section className="mb-8">
        <header className="sec-head">
          <span className="sec-head-title">Issues in this release</span>
          <span className="sec-head-sub">
            {issuesQ.data
              ? `${issueRows.length} total · ${issuesByStatus.active} active · ${issuesByStatus.resolved} resolved`
              : 'loading…'}
          </span>
        </header>

        {issuesQ.isLoading && <RowSkeleton count={2} height="48px" />}
        {issuesQ.isError && (
          <p className="border-y border-[color:var(--rule)] py-4 text-center text-[13px] text-[color:var(--danger)]">
            Failed to load issues. Refresh to retry.
          </p>
        )}
        {!issuesQ.isLoading && !issuesQ.isError && issueRows.length === 0 && (
          <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
            No active issues touching this release. Either nothing broke, or no events landed yet.
          </p>
        )}

        {issueRows.length > 0 && (
          <div className="border-y border-[color:var(--rule)] py-3">
            <Link
              className="inline-flex items-center gap-2 font-mono text-[12px] text-[color:var(--accent)] hover:opacity-80"
              to={`/main/org/${currentOrg.slug}/issues?release=${encodeURIComponent(release)}`}
            >
              <span>
                open {issueRows.length} issue{issueRows.length === 1 ? '' : 's'} in this release
              </span>
              <span aria-hidden>→</span>
            </Link>
            <p className="mt-1 font-mono text-[10px] text-[color:var(--ink-muted)]">
              opens the Issues view with{' '}
              <code className="text-[color:var(--ink-soft)]">?release=…</code> pre-applied
            </p>
          </div>
        )}
      </section>

      {/* ── SECONDARY: engineering hygiene (sourcemap / dSYM / etc) ── */}
      {artifactsQ.data && projectId && (
        <details className="mt-8">
          <summary className="cursor-pointer font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]">
            engineering hygiene · symbol artifacts
          </summary>
          <div className="mt-3">
            <SourceBundlesPanel
              artifacts={artifactsQ.data.sourcemaps.filter((a) =>
                a.kind.startsWith('source_bundle_')
              )}
              projectId={projectId}
              release={release}
            />
            <ArtifactSummary
              dsymCount={artifactsQ.data.dsyms.length}
              mappingCount={artifactsQ.data.mappings.length}
              sourcemapCount={
                artifactsQ.data.sourcemaps.filter((a) => a.kind === 'sourcemap').length
              }
            />
          </div>
        </details>
      )}
    </div>
  )
}

function groupByStatus(rows: ExploreRow[]): { active: number; resolved: number; other: number } {
  let active = 0
  let resolved = 0
  let other = 0
  for (const r of rows) {
    const s = String(r.status ?? '')
    if (s === 'active' || s === 'regressed') active++
    else if (s === 'resolved') resolved++
    else other++
  }
  return { active, resolved, other }
}

// `IssueRow` component was inlined here in v2.2 W2 but deleted in
// W4 — Release Detail now deep-links into /issues?release=X
// instead of duplicating the issue list (per v2.2 architecture:
// Issues is THE list view).

function SourceBundlesPanel({
  artifacts,
  projectId,
  release,
}: {
  artifacts: ReleaseSourcemap[]
  projectId: string
  release: string
}) {
  const qc = useQueryClient()
  const [confirmId, setConfirmId] = useState<null | string>(null)
  const deleteM = useMutation({
    mutationFn: (id: string) => adminApi.deleteReleaseArtifact(projectId, release, id),
    onSuccess: () => {
      setConfirmId(null)
      void qc.invalidateQueries({ queryKey: qk.releaseArtifacts(projectId, release) })
    },
  })

  return (
    <section className="mb-6">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
          Source bundles
        </h3>
      </header>
      {artifacts.length === 0 ? (
        <p className="border-y border-[color:var(--rule)] py-4 text-center text-[12px] text-[color:var(--ink-soft)]">
          No source bundles uploaded for this release. Run{' '}
          <code className="font-mono">
            sentori-cli upload source-bundle --platform ios|android …
          </code>{' '}
          to enable inline native source view.
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--rule-soft)] border-y border-[color:var(--rule)]">
          {artifacts.map((a) => {
            const platform = a.kind.replace(/^source_bundle_/, '')
            return (
              <li className="flex items-baseline gap-4 px-1 py-2" key={a.id}>
                <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                  {platform}
                </span>
                {a.moduleLabel ? (
                  <span className="shrink-0 rounded border border-[color:var(--rule)] px-1.5 py-0 font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] uppercase">
                    {a.moduleLabel}
                  </span>
                ) : null}
                <span className="flex-1 truncate text-[13px] text-[color:var(--ink)]">
                  {a.name}
                </span>
                <span className="font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
                  {a.entryCount !== null ? `${a.entryCount} files` : '—'}
                </span>
                <span className="font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
                  {a.uncompressedSizeBytes !== null ? formatBytes(a.uncompressedSizeBytes) : '—'}
                </span>
                <span className="font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
                  {formatRelative(a.createdAt)}
                </span>
                <button
                  className="rounded border border-[color:var(--danger)]/50 px-2 py-0.5 text-[11px] text-[color:var(--danger)] hover:bg-[color:var(--danger)]/10"
                  onClick={() => setConfirmId(a.id)}
                  type="button"
                >
                  Delete
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {confirmId !== null && (
        <ConfirmDelete
          error={deleteM.error}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => deleteM.mutate(confirmId)}
          pending={deleteM.isPending}
        />
      )}
    </section>
  )
}

function ConfirmDelete({
  error,
  onCancel,
  onConfirm,
  pending,
}: {
  error: unknown
  onCancel: () => void
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <div
      aria-modal
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-md border border-[color:var(--rule)] bg-[color:var(--paper)] shadow-xl">
        <header className="border-b border-[color:var(--rule)] px-4 py-3">
          <h3 className="font-medium text-[color:var(--ink)]">Delete source bundle?</h3>
        </header>
        <div className="space-y-3 px-4 py-3">
          <p className="text-[13px] text-[color:var(--ink-soft)]">
            Removes this archive + its in-memory path index. Native frames in this release that were
            rendering inline source will fall back to "no source" until you re-upload.
          </p>
          {error !== null && error !== undefined && (
            <p className="rounded border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/5 px-3 py-2 text-[12px] text-[color:var(--danger)]">
              {hintOf(error) ?? 'Delete failed. Try again.'}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              className="px-3 py-1.5 text-[12px] text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded bg-[color:var(--danger)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--paper)] disabled:opacity-50"
              disabled={pending}
              onClick={onConfirm}
              type="button"
            >
              {pending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ArtifactSummary({
  dsymCount,
  mappingCount,
  sourcemapCount,
}: {
  dsymCount: number
  mappingCount: number
  sourcemapCount: number
}) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        Other artifacts
      </h3>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px] text-[color:var(--ink-muted)]">
        <dt>JS sourcemaps</dt>
        <dd className="text-[color:var(--ink-soft)]">{sourcemapCount}</dd>
        <dt>iOS dSYMs</dt>
        <dd className="text-[color:var(--ink-soft)]">{dsymCount}</dd>
        <dt>Android proguard</dt>
        <dd className="text-[color:var(--ink-soft)]">{mappingCount}</dd>
      </dl>
    </section>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function hintOf(error: unknown): null | string {
  if (isStructuredError(error)) {
    return error.body.error.hint ?? error.body.error.message
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return null
}
