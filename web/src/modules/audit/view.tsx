import { Alert, Button, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useInfiniteQuery } from '@tanstack/react-query'

import { auditApi, type AuditRow } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

const PAGE_SIZE = 200

/**
 * Append-only audit log — cursor pagination via useInfiniteQuery +
 * `?before=<rfc3339>`. First page is 200 rows; the table renders as
 * GDS DataTable + a "Load older" Button below when more history is
 * reachable.
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
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'audit' },
        ]}
        subtitle={`${rows.length.toLocaleString()} entries · append-only`}
        title="Audit"
      />

      {error && (
        <Alert title="Failed to load audit log" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <Card>
          <EmptyState
            description="Audit captures every mutating action across the org."
            title="No entries yet"
          />
        </Card>
      )}

      {(isLoading || rows.length > 0) && (
        <DataTable<AuditRow>
          columns={[
            {
              key: 'createdAt',
              label: 'When',
              width: '160px',
              render: (_v, r) => (
                <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                  {formatRelative(r.createdAt)}
                </span>
              ),
            },
            {
              key: 'actorEmail',
              label: 'Actor',
              width: '220px',
              render: (_v, r) => (
                <span className="text-accent font-mono text-[12px]">
                  {r.actorEmail ?? 'system'}
                </span>
              ),
            },
            {
              key: 'action',
              label: 'Action',
              render: (_v, r) => <span className="text-fg font-mono text-[12px]">{r.action}</span>,
            },
            {
              key: 'target',
              label: 'Target',
              render: (_v, r) => (
                <span className="text-fg-secondary font-mono text-[11px]">
                  {r.targetType}:{r.targetId ?? '—'}
                </span>
              ),
            },
          ]}
          density="compact"
          loading={isLoading}
          loadingRows={6}
          rowKey="id"
          rows={rows}
          stickyHeader
          striped
        />
      )}

      {q.hasNextPage && (
        <div className="flex items-center justify-center py-2">
          <Button
            disabled={isLoadingMore}
            loading={isLoadingMore}
            onClick={() => void q.fetchNextPage()}
            size="sm"
            variant="secondary"
          >
            ↓ Load older
          </Button>
        </div>
      )}
      {!q.hasNextPage && rows.length >= PAGE_SIZE && (
        <p className="border-border/40 text-fg-muted border-y py-3 text-center font-mono text-[10px] tracking-[0.18em] uppercase">
          end of history
        </p>
      )}
    </div>
  )
}
