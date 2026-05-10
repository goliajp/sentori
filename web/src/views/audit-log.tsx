import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { auditApi, type AuditRow, orgsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { useHasPermission } from '@/auth/useHasPermission'

// Mirrors server/src/audit.rs::actions. Kept in sync by hand for now;
// Phase 20 sub-A turns this into a generated enum so the UI list never
// drifts from what the server records.
const ACTION_OPTIONS: { label: string; value: string }[] = [
  { label: 'All actions', value: '' },
  { label: 'org.created', value: 'org.created' },
  { label: 'org.patched', value: 'org.patched' },
  { label: 'org.deleted', value: 'org.deleted' },
  { label: 'org.transfer.requested', value: 'org.transfer.requested' },
  { label: 'org.transfer.accepted', value: 'org.transfer.accepted' },
  { label: 'member.role_patched', value: 'member.role_patched' },
  { label: 'member.removed', value: 'member.removed' },
  { label: 'team.created', value: 'team.created' },
  { label: 'team.patched', value: 'team.patched' },
  { label: 'team.deleted', value: 'team.deleted' },
  { label: 'team.member.added', value: 'team.member.added' },
  { label: 'team.member.removed', value: 'team.member.removed' },
  { label: 'project.created', value: 'project.created' },
  { label: 'project.team.bound', value: 'project.team.bound' },
  { label: 'project.team.unbound', value: 'project.team.unbound' },
  { label: 'token.created', value: 'token.created' },
  { label: 'token.revoked', value: 'token.revoked' },
]

const PAGE_LIMIT = 100

export function AuditLogView() {
  const { currentOrg } = useOrg()
  const slug = currentOrg.slug
  const allowed = useHasPermission('audit.read')

  const [action, setAction] = useState('')
  const [actorUserId, setActorUserId] = useState('')
  // Empty string means "now" — the server defaults `before` to OffsetDateTime::now_utc.
  const [before, setBefore] = useState('')

  const membersQuery = useQuery({
    enabled: allowed,
    queryFn: () => orgsApi.listMembers(slug),
    queryKey: ['members', slug],
  })

  const params = useMemo(
    () => ({
      action: action || undefined,
      actorUserId: actorUserId || undefined,
      before: before ? new Date(before).toISOString() : undefined,
      limit: PAGE_LIMIT,
    }),
    [action, actorUserId, before]
  )

  const auditQuery = useQuery({
    enabled: allowed,
    queryFn: () => auditApi.list(slug, params),
    queryKey: ['audit', slug, params],
  })

  if (!allowed) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <p className="text-fg-muted text-sm">Only org admins can view the audit log.</p>
      </div>
    )
  }

  const rows = auditQuery.data ?? []
  const hasMore = rows.length === PAGE_LIMIT

  const onLoadMore = () => {
    if (rows.length === 0) return
    setBefore(rows[rows.length - 1]!.createdAt)
  }

  const onExportCsv = () => {
    const header = ['timestamp', 'actor', 'action', 'target_type', 'target_id', 'payload']
    const csvRows = [header.join(',')]
    for (const r of rows) {
      const fields = [
        r.createdAt,
        r.actorEmail ?? r.actorUserId ?? '',
        r.action,
        r.targetType,
        r.targetId ?? '',
        JSON.stringify(r.payload),
      ].map(csvEscape)
      csvRows.push(fields.join(','))
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sentori-${slug}-audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-fg text-xl font-semibold">Audit log</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Append-only record of admin actions in <span className="font-mono">{slug}</span>.
          </p>
        </div>
        <button
          className="border-border text-fg-muted hover:bg-bg-tertiary rounded-md border px-3 py-1.5 text-[12px]"
          disabled={rows.length === 0}
          onClick={onExportCsv}
          type="button"
        >
          Export CSV
        </button>
      </header>

      <section className="border-border flex flex-wrap items-center gap-3 rounded-md border p-3">
        <select
          className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1 text-[13px]"
          onChange={(e) => setAction(e.target.value)}
          value={action}
        >
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1 text-[13px]"
          onChange={(e) => setActorUserId(e.target.value)}
          value={actorUserId}
        >
          <option value="">All actors</option>
          {(membersQuery.data ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.email}
            </option>
          ))}
        </select>
        <input
          className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1 text-[13px]"
          onChange={(e) => setBefore(e.target.value)}
          title="Show entries strictly before this time"
          type="datetime-local"
          value={before}
        />
        {(action || actorUserId || before) && (
          <button
            className="text-fg-muted hover:text-fg ml-auto text-[12px]"
            onClick={() => {
              setAction('')
              setActorUserId('')
              setBefore('')
            }}
            type="button"
          >
            Clear filters
          </button>
        )}
      </section>

      {auditQuery.isLoading ? (
        <p className="text-fg-muted text-sm">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-fg-muted text-sm">No matching entries.</p>
      ) : (
        <>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-fg-muted border-border border-b text-left text-[11px] tracking-wider uppercase">
                <th className="px-2 py-2 font-medium">Time</th>
                <th className="px-2 py-2 font-medium">Actor</th>
                <th className="px-2 py-2 font-medium">Action</th>
                <th className="px-2 py-2 font-medium">Target</th>
                <th className="px-2 py-2 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <AuditRowItem key={r.id} row={r} />
              ))}
            </tbody>
          </table>
          {hasMore && (
            <button
              className="border-border text-fg-muted hover:bg-bg-tertiary mx-auto block rounded-md border px-3 py-1.5 text-[12px]"
              onClick={onLoadMore}
              type="button"
            >
              Load older →
            </button>
          )}
        </>
      )}
    </div>
  )
}

function AuditRowItem({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false)
  const payloadStr = JSON.stringify(row.payload, null, 2)
  const empty = payloadStr === '{}' || payloadStr === 'null'

  return (
    <>
      <tr className="border-border/50 border-b align-top">
        <td className="text-fg-muted px-2 py-2 font-mono text-[11px] tabular-nums">
          {new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 19)}
        </td>
        <td className="text-fg px-2 py-2 font-mono text-[12px]">
          {row.actorEmail ?? <span className="text-fg-muted italic">system</span>}
        </td>
        <td className="text-fg px-2 py-2 font-mono text-[12px]">{row.action}</td>
        <td className="text-fg-muted px-2 py-2 text-[12px]">
          <span className="font-mono">{row.targetType}</span>
          {row.targetId && (
            <span className="text-fg-muted ml-1 font-mono text-[10px]">
              {row.targetId.slice(0, 8)}…
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-[12px]">
          {empty ? (
            <span className="text-fg-muted">—</span>
          ) : (
            <button
              className="text-fg-muted hover:text-fg"
              onClick={() => setOpen((o) => !o)}
              type="button"
            >
              {open ? 'Hide' : 'Show'}
            </button>
          )}
        </td>
      </tr>
      {open && !empty && (
        <tr>
          <td className="px-2 pb-3" colSpan={5}>
            <pre className="bg-bg-tertiary text-fg overflow-x-auto rounded p-2 font-mono text-[11px]">
              {payloadStr}
            </pre>
          </td>
        </tr>
      )}
    </>
  )
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}
