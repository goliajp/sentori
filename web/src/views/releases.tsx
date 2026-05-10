import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type ReleaseListRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'

/**
 * Phase 23 sub-A: project releases list. Card per release with the
 * stats that matter for triage:
 *  - deploy timestamp (or first-seen as fallback)
 *  - event count
 *  - artifact uploads (sourcemap / dSYM / proguard mapping counts)
 *
 * Phase 23 sub-B will add a per-release detail page (artifact tree +
 * deploy timeline + compare with previous). Sub-D's regression chip
 * gets layered on top of the card here when it lands.
 */
export function ReleasesView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listReleases(projectId!),
    queryKey: ['releases', projectId],
  })

  if (!projectId) {
    return (
      <EmptyState
        hint="Create one in your org settings to see releases."
        title="No project in this org yet"
      />
    )
  }
  if (isLoading) return <LoadingState />
  if (error) return <ErrorState label="Failed to load releases." />

  const rows = data ?? []
  if (rows.length === 0) {
    return (
      <EmptyState
        hint={
          <>
            Releases land here automatically when an event arrives, or when{' '}
            <code className="font-mono">sentori-cli upload</code> runs against this project.
          </>
        }
        title="No releases yet"
      />
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-fg text-xl font-semibold">Releases</h1>
        <span className="text-fg-muted text-[12px]">{rows.length} release(s)</span>
      </header>

      <ul className="space-y-2">
        {rows.map((r) => (
          <ReleaseCard key={r.id} orgSlug={currentOrg.slug} row={r} />
        ))}
      </ul>
    </div>
  )
}

function ReleaseCard({ orgSlug, row }: { orgSlug: string; row: ReleaseListRow }) {
  const deployStamp = row.deployAt ?? row.firstSeen ?? row.createdAt
  return (
    <li>
      <Link
        className="border-border hover:bg-bg-tertiary/40 block rounded-md border p-4"
        to={`/org/${orgSlug}/releases/${encodeURIComponent(row.name)}`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-fg truncate font-mono text-[13px] font-semibold">{row.name}</h2>
          <time
            className="text-fg-muted shrink-0 font-mono text-[11px] tabular-nums"
            dateTime={deployStamp}
            title={new Date(deployStamp).toISOString()}
          >
            {relativeDay(deployStamp)}
          </time>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-4">
          <Stat label="Events" value={row.eventCount.toLocaleString()} />
          <Stat label="Source maps" value={row.sourcemapCount} muted={row.sourcemapCount === 0} />
          <Stat label="iOS dSYMs" value={row.dsymCount} muted={row.dsymCount === 0} />
          <Stat label="ProGuard" value={row.mappingCount} muted={row.mappingCount === 0} />
        </dl>
        {row.firstSeen && row.lastSeen && (
          <p className="text-fg-muted mt-2 text-[11px]">
            {relativeDay(row.firstSeen)} → {relativeDay(row.lastSeen)}
          </p>
        )}
      </Link>
    </li>
  )
}

function Stat({ label, muted, value }: { label: string; muted?: boolean; value: number | string }) {
  return (
    <div>
      <dt className="text-fg-muted text-[10px] tracking-wider uppercase">{label}</dt>
      <dd
        className={`font-mono text-[13px] tabular-nums ${muted ? 'text-fg-muted/70' : 'text-fg'}`}
      >
        {value}
      </dd>
    </div>
  )
}

function relativeDay(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days <= 0) {
    const hours = Math.floor(ms / 3_600_000)
    if (hours <= 0) return 'just now'
    return `${hours}h ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
