import { useInfiniteQuery } from '@tanstack/react-query'

import { auditApi, type AuditRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { EmptyState } from '@/components/Hint'
import { RowSkeleton } from '@/components/Skeleton'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

const PAGE_SIZE = 200

/**
 * v2.1 — proper cursor pagination via `useInfiniteQuery` + the
 * server's `?before=<rfc3339>` cursor.
 *
 * Before this commit: single fetch with `limit=500`, hard ceiling,
 * "showing latest 500" warning when full. Operators of busy orgs
 * couldn't read past the most recent 500 audit entries.
 *
 * Now: first page is 200 rows (fast first paint). Bottom-of-list
 * "Load older" button issues a follow-up fetch with
 * `before=oldestSeen`. Pages accumulate in react-query's internal
 * pageParam machinery; the dashboard flattens them for render.
 * No client-side ceiling — operator can walk back as far as they
 * need.
 *
 * Server respects the same 500 cap per page; the dashboard's
 * page-size of 200 stays under that for snappy round-trips.
 */
export function AuditLogView() {
  const { currentOrg } = useOrg()

  const q = useInfiniteQuery({
    enabled: !!currentOrg.slug,
    initialPageParam: null as null | string,
    queryFn: ({ pageParam }: { pageParam: null | string }) =>
      auditApi.list(currentOrg.slug, {
        limit: PAGE_SIZE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    queryKey: qk.audit(currentOrg.slug),
    getNextPageParam: (lastPage: AuditRow[]) => {
      if (lastPage.length < PAGE_SIZE) return null
      const oldest = lastPage[lastPage.length - 1]
      return oldest?.createdAt ?? null
    },
  })

  const rows: AuditRow[] = q.data?.pages.flat() ?? []
  const isLoading = q.isLoading
  const error = q.error
  const isLoadingMore = q.isFetchingNextPage

  return (
    <div className="sentori-page-in">
      <PageHeader
        count={rows.length}
        subtitle="append-only · every mutating action"
        title="Audit"
      />

      {isLoading && <RowSkeleton count={6} height="40px" />}
      {error && <EmptyState>Failed to load audit log.</EmptyState>}
      {!isLoading && !error && rows.length === 0 && <EmptyState>No entries yet.</EmptyState>}

      {rows.length > 0 && (
        <>
          <table className="bench">
            <thead>
              <tr>
                <th>when</th>
                <th>actor</th>
                <th>action</th>
                <th>target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="num">{formatRelative(e.createdAt)}</td>
                  <td className="text-[color:var(--accent)]">{e.actorEmail ?? 'system'}</td>
                  <td className="lead">{e.action}</td>
                  <td className="text-[color:var(--ink-soft)]">
                    {e.targetType}:{e.targetId ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {q.hasNextPage && (
            <div className="flex items-center justify-center border-y border-[color:var(--rule)] py-4">
              <button
                className="inline-flex h-8 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-4 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink)] uppercase transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isLoadingMore}
                onClick={() => void q.fetchNextPage()}
                type="button"
              >
                {isLoadingMore ? 'loading…' : '↓ load older'}
              </button>
            </div>
          )}
          {!q.hasNextPage && rows.length >= PAGE_SIZE && (
            <p className="border-y border-[color:var(--rule)] py-3 text-center font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              end of history
            </p>
          )}
        </>
      )}
    </div>
  )
}
