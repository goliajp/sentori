import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { Sparkline } from '@/components/Sparkline'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

type MetricName = { name: string; count: number; lastSeen: string }
type MetricPoint = { id: string; ts: string; value: number; tags: unknown }

/**
 * Custom metrics — `sentori.recordMetric(name, value, tags?)` channel.
 * Picker (DataTable of metric names) on top; when a name is picked
 * via `?metric=` URL state, a Card panel renders with sparkline +
 * points DataTable underneath.
 */
export function MetricsView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [selected, setSelected] = useUrlParam<string>('metric', '')

  const namesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listMetricNames(projectId!),
    queryKey: qk.metrics.names(projectId),
  })

  const pointsQ = useQuery({
    enabled: !!projectId && !!selected,
    queryFn: () => adminApi.listMetrics(projectId!, { name: selected }),
    queryKey: qk.metrics.points(projectId, selected),
  })

  const names = namesQ.data ?? []
  const points = pointsQ.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'metrics' },
        ]}
        subtitle="custom metrics · last 24 hours"
        title="Metrics"
      />

      {namesQ.isError && (
        <Alert title="Failed to load metric names" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      {!namesQ.isLoading && !namesQ.isError && names.length === 0 && (
        <Card>
          <EmptyState
            description="Call sentori.recordMetric('name', value) from the host app to populate this list."
            title="No custom metrics yet"
          />
        </Card>
      )}

      {names.length > 0 && (
        <DataTable<MetricName>
          columns={[
            {
              key: 'name',
              label: 'Metric',
              render: (_v, r) => <span className="text-fg font-mono text-[12px]">{r.name}</span>,
            },
            {
              align: 'right',
              key: 'count',
              label: 'Points',
              sortable: true,
              width: '120px',
              render: (_v, r) => (
                <span className="font-mono text-[12px] tabular-nums">
                  {r.count.toLocaleString()}
                </span>
              ),
            },
            {
              align: 'right',
              key: 'lastSeen',
              label: 'Last seen',
              width: '140px',
              render: (_v, r) => (
                <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                  {formatRelative(r.lastSeen)}
                </span>
              ),
            },
          ]}
          density="compact"
          highlightOnHover
          loading={namesQ.isLoading}
          onRowClick={(row) => setSelected(row.name)}
          rowKey="name"
          rows={names}
          stickyHeader
          striped
        />
      )}

      {selected && (
        <Card>
          <header className="border-border-muted mb-3 flex items-baseline justify-between border-b pb-2">
            <span className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
              metric
            </span>
            <button
              className="text-fg-muted hover:text-accent cursor-pointer font-mono text-[10px] tracking-[0.18em] uppercase"
              onClick={() => setSelected('')}
              type="button"
            >
              close
            </button>
          </header>
          <h2 className="text-fg mb-3 font-mono text-[18px]">{selected}</h2>

          {pointsQ.isLoading && (
            <p className="text-fg-secondary py-4 text-center text-[13px]">Loading points…</p>
          )}
          {pointsQ.isError && (
            <Alert title="Failed to load points" variant="danger">
              Refresh to retry.
            </Alert>
          )}
          {!pointsQ.isLoading && points.length === 0 && (
            <EmptyState
              description="No points recorded for this metric in the last 24h."
              title="Quiet"
            />
          )}
          {points.length > 0 && (
            <>
              <div className="border-border-muted mb-3 border-y py-3">
                <Sparkline
                  ariaLabel={`${selected} trend`}
                  height={64}
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  values={points.map((p) => p.value).reverse()}
                  width={800}
                />
              </div>
              <DataTable<MetricPoint>
                columns={[
                  {
                    key: 'ts',
                    label: 'Timestamp',
                    render: (_v, r) => (
                      <span className="font-mono text-[11px] tabular-nums">{r.ts}</span>
                    ),
                  },
                  {
                    align: 'right',
                    key: 'value',
                    label: 'Value',
                    width: '120px',
                    render: (_v, r) => (
                      <span className="text-fg font-mono text-[12px] tabular-nums">
                        {r.value.toLocaleString()}
                      </span>
                    ),
                  },
                  {
                    key: 'tags',
                    label: 'Tags',
                    render: (_v, r) => (
                      <span className="text-fg-muted font-mono text-[11px]">
                        {stringifyTags(r.tags)}
                      </span>
                    ),
                  },
                ]}
                density="compact"
                rowKey="id"
                rows={points}
                striped
              />
            </>
          )}
        </Card>
      )}
    </div>
  )
}

function stringifyTags(t: unknown): string {
  if (!t || typeof t !== 'object') return ''
  const entries = Object.entries(t as Record<string, unknown>)
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(' ')
}
