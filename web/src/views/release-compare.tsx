import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi, type ReleaseCompareRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { ErrorState, LoadingState } from '@/components/states'
import { formatRelative as relativeDay } from '@/lib/format'

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
          className="text-fg-muted hover:text-fg t-md"
          to={`/org/${currentOrg.slug}/releases/${encodeURIComponent(target)}`}
        >
          ← {target}
        </Link>
        <h1 className="text-fg mt-2 font-mono text-[16px] font-semibold">
          <span className="text-fg-muted">{data.base}</span>
          <span className="text-fg-muted mx-2">→</span>
          <span>{data.target}</span>
        </h1>
        <p className="text-fg-muted t-md mt-1">
          {data.added.length + data.fixed.length + data.persisting.length} issue
          {data.added.length + data.fixed.length + data.persisting.length === 1 ? '' : 's'} touched
          between these releases.
        </p>
      </header>

      {/* Phase 50 sub-A5 — stacked-proportion bar so the user reads
          the relative move (Added vs Fixed vs Persisting) at a
          glance before scanning the lists below. */}
      <ReleaseCompareBar
        added={data.added.length}
        fixed={data.fixed.length}
        persisting={data.persisting.length}
      />

      <CompareSection
        accentClass="text-[color:var(--color-danger)] bg-red-500/15 ring-red-500/30"
        emptyHint={`No new issues in ${data.target} that weren't already in ${data.base}.`}
        orgSlug={currentOrg.slug}
        rows={data.added}
        subtitle={`In ${data.target}, not in ${data.base}`}
        title="Added"
      />

      <CompareSection
        accentClass="text-[color:var(--color-success)] bg-green-500/15 ring-green-500/30"
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

/**
 * Phase 50 sub-A5 — stacked-proportion bar of issue movement between
 * two releases. Three segments (danger/success/muted) sized by count,
 * with the absolute numbers + delta surfaced inline.
 */
function ReleaseCompareBar({
  added,
  fixed,
  persisting,
}: {
  added: number
  fixed: number
  persisting: number
}) {
  const total = added + fixed + persisting
  if (total === 0) return null
  const net = added - fixed
  return (
    <div className="border-border bg-bg-secondary space-y-3 rounded-md border p-4">
      <div className="t-sm flex items-baseline justify-between">
        <div className="text-fg-muted tracking-wider uppercase">Movement</div>
        <div className="text-fg-muted">
          <span
            className={
              net > 0
                ? 'text-[color:var(--color-danger)]'
                : net < 0
                  ? 'text-[color:var(--color-success)]'
                  : 'text-fg-muted'
            }
          >
            {net > 0 ? '↑' : net < 0 ? '↓' : '—'} net {Math.abs(net)}
          </span>{' '}
          {net > 0 ? 'new bugs' : net < 0 ? 'bugs cleared' : 'change'}
        </div>
      </div>
      <div className="border-border flex h-2 overflow-hidden rounded border">
        <div
          className="bg-[color:var(--color-danger)]"
          style={{ width: `${(added / total) * 100}%` }}
          title={`${added} added`}
        />
        <div
          className="bg-[color:var(--color-success)]"
          style={{ width: `${(fixed / total) * 100}%` }}
          title={`${fixed} fixed`}
        />
        <div
          className="bg-fg-muted/30"
          style={{ width: `${(persisting / total) * 100}%` }}
          title={`${persisting} persisting`}
        />
      </div>
      <div className="text-fg-muted t-sm flex justify-between font-mono tabular-nums">
        <span>
          <span className="text-[color:var(--color-danger)]">●</span> {added} added
        </span>
        <span>
          <span className="text-[color:var(--color-success)]">●</span> {fixed} fixed
        </span>
        <span>
          <span className="opacity-50">●</span> {persisting} persisting
        </span>
      </div>
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
        <h2 className="text-fg t-md font-semibold">
          {title}
          <span
            className={`t-sm ml-2 rounded px-1.5 py-0.5 font-medium tabular-nums ring-1 ${accentClass}`}
          >
            {rows.length}
          </span>
        </h2>
        <p className="text-fg-muted t-sm">{subtitle}</p>
      </header>
      {rows.length === 0 ? (
        <p className="text-fg-muted t-md mt-2">{emptyHint}</p>
      ) : (
        <ul className="border-border divide-border mt-2 divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                className="hover:bg-bg-tertiary/40 flex items-center justify-between gap-3 px-4 py-2"
                to={`/org/${orgSlug}/issues/${r.id}`}
              >
                <div className="flex min-w-0 flex-1 items-baseline gap-3">
                  <span className="text-fg t-md truncate font-medium">{r.errorType}</span>
                  <span className="text-fg-muted t-md truncate">{r.messageSample}</span>
                </div>
                <div className="text-fg-muted t-sm shrink-0 text-right">
                  <div className="font-mono tabular-nums">{r.eventCount.toLocaleString()} ev</div>
                  <div className="t-sm">{relativeDay(r.lastSeen)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// `relativeDay` is aliased to the shared `formatRelative` (see imports).
