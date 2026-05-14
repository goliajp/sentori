import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type ReleaseListRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { EmptyArt, PageBody, PageHeader, PageShell } from '@/components/ui'
import { formatRelative as relativeDay } from '@/lib/format'

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
        icon={<EmptyArt kind="project" />}
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
        icon={<EmptyArt kind="releases" />}
        title="No releases yet"
      />
    )
  }

  return (
    <PageShell>
      <PageHeader
        actions={<span className="text-fg-muted t-md">{rows.length} releases</span>}
        title="Releases"
      />
      <PageBody>
        <ul className="space-y-2">
          {rows.map((r) => (
            <ReleaseCard key={r.id} orgSlug={currentOrg.slug} row={r} />
          ))}
        </ul>
      </PageBody>
    </PageShell>
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
          <h2 className="text-fg truncate font-mono t-md font-semibold">{row.name}</h2>
          <time
            className="text-fg-muted shrink-0 font-mono t-sm tabular-nums"
            dateTime={deployStamp}
            title={new Date(deployStamp).toISOString()}
          >
            {relativeDay(deployStamp)}
          </time>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 t-md sm:grid-cols-4">
          <Stat label="Events" value={row.eventCount.toLocaleString()} />
          <Stat label="Source maps" value={row.sourcemapCount} muted={row.sourcemapCount === 0} />
          <Stat label="iOS dSYMs" value={row.dsymCount} muted={row.dsymCount === 0} />
          <Stat label="ProGuard" value={row.mappingCount} muted={row.mappingCount === 0} />
        </dl>
        {row.firstSeen && row.lastSeen && (
          <p className="text-fg-muted mt-2 t-sm">
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
      <dt className="text-fg-muted t-sm tracking-wider uppercase">{label}</dt>
      <dd
        className={`font-mono t-md tabular-nums ${muted ? 'text-fg-muted/70' : 'text-fg'}`}
      >
        {value}
      </dd>
    </div>
  )
}

// `relativeDay` was a per-file helper that returned strings like
// `5d ago` / `yesterday` / `3mo ago`. We now alias the shared
// `formatRelative` which returns the shorter `5d / 3mo / 1y` and
// rounds defensively (no negative output for clock skew).
