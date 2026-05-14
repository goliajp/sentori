import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { auditApi, userActivityApi, type UserActivityRow } from '@/api/client'
import { useAuth } from '@/auth/state'

const PAGE_LIMIT = 100

export function UserActivityView() {
  const { user } = useAuth()
  const [before, setBefore] = useState<null | string>(null)

  const actionsCatalog = useQuery({
    queryFn: () => auditApi.actions(),
    queryKey: ['audit-actions'],
    staleTime: 5 * 60_000,
  })
  const labelFor = (code: string): string => {
    const found = (actionsCatalog.data ?? []).find((a) => a.code === code)
    return found?.label ?? code
  }

  const activityQuery = useQuery({
    queryFn: () =>
      userActivityApi.list({
        before: before ?? undefined,
        limit: PAGE_LIMIT,
      }),
    queryKey: ['my-activity', before],
  })

  const rows = activityQuery.data ?? []
  const hasMore = rows.length === PAGE_LIMIT

  return (
    <div className="space-y-5 p-6">
      <header>
        <h1 className="text-fg text-xl font-semibold">My activity</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Every admin action you've taken across orgs you're a member of.{' '}
          {user && <span className="t-md font-mono">{user.email}</span>}
        </p>
      </header>

      {activityQuery.isLoading ? (
        <p className="text-fg-muted text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-fg-muted text-sm">No actions recorded yet.</p>
      ) : (
        <ol className="border-border divide-border divide-y rounded-md border">
          {rows.map((r) => (
            <ActivityItem key={r.id} label={labelFor(r.action)} row={r} />
          ))}
        </ol>
      )}

      {hasMore && (
        <button
          className="border-border text-fg-muted hover:bg-bg-tertiary t-md mx-auto block rounded-md border px-3 py-1.5"
          onClick={() => setBefore(rows[rows.length - 1]!.createdAt)}
          type="button"
        >
          Load older →
        </button>
      )}
    </div>
  )
}

function ActivityItem({ label, row }: { label: string; row: UserActivityRow }) {
  const ts = new Date(row.createdAt)
  return (
    <li className="flex items-baseline gap-3 px-4 py-3">
      <time
        className="text-fg-muted t-sm shrink-0 font-mono tabular-nums"
        dateTime={row.createdAt}
        title={ts.toISOString()}
      >
        {ts.toISOString().replace('T', ' ').slice(0, 19)}
      </time>
      <div className="min-w-0 flex-1">
        <div className="text-fg t-md">{label}</div>
        <div className="text-fg-muted t-md">
          in{' '}
          {row.orgSlug ? (
            <Link className="text-accent hover:underline" to={`/org/${row.orgSlug}/issues`}>
              {row.orgName ?? row.orgSlug}
            </Link>
          ) : (
            <span className="italic">deleted org</span>
          )}
          <span className="t-sm ml-2 font-mono uppercase">{row.targetType}</span>
        </div>
      </div>
    </li>
  )
}
