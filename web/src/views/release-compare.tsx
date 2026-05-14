import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi, type ReleaseCompareRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { ErrorState, LoadingState } from '@/components/states'

/**
 * Phase 23 sub-E: diff issues between two releases.
 *
 * URL shape: `/org/{slug}/releases/{base}/compare/{target}`. The page
 * shows three sections — Added (regression risk), Fixed (regression
 * candidates if they come back), Persisting — each rendered as an
 * issue list with a quick link into issue detail. Counts are visible
 * in section headers so the diff health is readable at a glance even
 * before scrolling.
 */
export function ReleaseCompareView() {
  const { base, target } = useParams<{ base: string; target: string }>()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId && !!base && !!target,
    queryFn: () => adminApi.compareReleases(projectId!, base!, target!),
    queryKey: ['release-compare', projectId, base, target],
  })

  if (!projectId || !base || !target) {
    return <ErrorState label="Missing release context." />
  }
  if (isLoading) return <LoadingState />
  if (error) return <ErrorState label="Failed to load comparison." />
  if (!data) return null

  return (
    <div className="space-y-6 p-6">
      <header>
        <Link
          className="text-fg-muted hover:text-fg text-[12px]"
          to={`/org/${currentOrg.slug}/releases/${encodeURIComponent(target)}`}
        >
          ← {target}
        </Link>
        <h1 className="text-fg mt-2 font-mono text-[16px] font-semibold">
          <span className="text-fg-muted">{data.base}</span>
          <span className="text-fg-muted mx-2">→</span>
          <span>{data.target}</span>
        </h1>
        <p className="text-fg-muted mt-1 text-[12px]">
          {data.added.length + data.fixed.length + data.persisting.length} issue
          {data.added.length + data.fixed.length + data.persisting.length === 1 ? '' : 's'} touched
          between these releases.
        </p>
      </header>

      <CompareSection
        accentClass="text-red-300 bg-red-500/15 ring-red-500/30"
        emptyHint={`No new issues in ${data.target} that weren't already in ${data.base}.`}
        orgSlug={currentOrg.slug}
        rows={data.added}
        subtitle={`In ${data.target}, not in ${data.base}`}
        title="Added"
      />

      <CompareSection
        accentClass="text-green-300 bg-green-500/15 ring-green-500/30"
        emptyHint={`No issues from ${data.base} disappeared in ${data.target}.`}
        orgSlug={currentOrg.slug}
        rows={data.fixed}
        subtitle={`In ${data.base}, not in ${data.target}`}
        title="Fixed"
      />

      <CompareSection
        accentClass="text-fg-muted bg-bg-tertiary ring-border"
        emptyHint="No overlap between these releases."
        orgSlug={currentOrg.slug}
        rows={data.persisting}
        subtitle="In both releases"
        title="Persisting"
      />
    </div>
  )
}

function CompareSection({
  accentClass,
  emptyHint,
  orgSlug,
  rows,
  subtitle,
  title,
}: {
  accentClass: string
  emptyHint: string
  orgSlug: string
  rows: ReleaseCompareRow[]
  subtitle: string
  title: string
}) {
  return (
    <section>
      <header className="flex items-baseline gap-3">
        <h2 className="text-fg text-[13px] font-semibold">
          {title}
          <span
            className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ring-1 ${accentClass}`}
          >
            {rows.length}
          </span>
        </h2>
        <p className="text-fg-muted text-[11px]">{subtitle}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-fg-muted mt-2 text-[12px]">{emptyHint}</p>
      ) : (
        <ul className="border-border divide-border mt-2 divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                className="hover:bg-bg-tertiary/40 flex items-center justify-between gap-3 px-4 py-2"
                to={`/org/${orgSlug}/issues/${r.id}`}
              >
                <div className="flex min-w-0 flex-1 items-baseline gap-3">
                  <span className="text-fg truncate text-[13px] font-medium">{r.errorType}</span>
                  <span className="text-fg-muted truncate text-[12px]">{r.messageSample}</span>
                </div>
                <div className="text-fg-muted shrink-0 text-right text-[11px]">
                  <div className="font-mono tabular-nums">{r.eventCount.toLocaleString()} ev</div>
                  <div className="text-[10px]">{relativeDay(r.lastSeen)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function relativeDay(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return iso
  const days = Math.floor(ms / 86_400_000)
  if (days <= 0) {
    const hours = Math.floor(ms / 3_600_000)
    if (hours <= 0) return 'just now'
    return `${hours}h ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}
