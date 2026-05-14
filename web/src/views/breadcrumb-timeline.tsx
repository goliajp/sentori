/**
 * Phase 25 sub-C: breadcrumb timeline.
 *
 * Renders the per-event breadcrumb list as a vertical timeline:
 *   - left gutter: timestamp + a type-coloured dot
 *   - body: a one-line summary that's type-specific (nav from→to, net
 *     METHOD URL status, log level + message, user action target,
 *     custom JSON)
 *   - colour comes from the type and, for net / log, the status / level
 *
 * Adjacent same-type breadcrumbs that fire in quick succession (≤1s
 * apart) collapse into a fold-down group: 3+ rows compress to "type ×N
 * — first event …", clickable to expand. Groups of 1–2 render
 * inline so the chevron doesn't show up everywhere.
 *
 * Grouping logic is exposed (`groupBreadcrumbs`) so it can be unit
 * tested without rendering React. It's a pure function over a
 * structurally-typed crumb subset; works for the protocol's Breadcrumb
 * but doesn't insist on it.
 */

import { useState } from 'react'

import type { Breadcrumb } from '@/api/client'

const COLLAPSE_MIN = 3
const SAME_GROUP_GAP_MS = 1000

export type GroupableCrumb = {
  data: Record<string, unknown>
  timestamp: string
  type: string
}

export type CrumbGroup = {
  crumbs: GroupableCrumb[]
  type: string
}

export function groupBreadcrumbs(crumbs: GroupableCrumb[]): CrumbGroup[] {
  const out: CrumbGroup[] = []
  let cur: CrumbGroup | null = null
  let prevTs = 0
  for (const c of crumbs) {
    const ts = Date.parse(c.timestamp)
    const gap = ts - prevTs
    if (cur && cur.type === c.type && gap <= SAME_GROUP_GAP_MS) {
      cur.crumbs.push(c)
    } else {
      cur = { crumbs: [c], type: c.type }
      out.push(cur)
    }
    prevTs = ts
  }
  return out
}

const TYPE_DOT: Record<string, string> = {
  custom: 'bg-fg-muted',
  log: 'bg-fg-muted',
  nav: 'bg-blue-400',
  net: 'bg-amber-400',
  user: 'bg-violet-400',
}

export function BreadcrumbTimeline({ breadcrumbs }: { breadcrumbs: Breadcrumb[] }) {
  const groups = groupBreadcrumbs(breadcrumbs)
  return (
    <div className="border-border overflow-hidden rounded-md border">
      {groups.map((g, i) => (
        <CrumbGroupRow first={i === 0} group={g} key={i} last={i === groups.length - 1} />
      ))}
    </div>
  )
}

function CrumbGroupRow({
  first,
  group,
  last,
}: {
  first: boolean
  group: CrumbGroup
  last: boolean
}) {
  const collapsible = group.crumbs.length >= COLLAPSE_MIN
  const [open, setOpen] = useState(!collapsible)
  const visible = collapsible && !open ? [group.crumbs[0]!] : group.crumbs

  return (
    <div>
      {visible.map((c, j) => (
        <CrumbRow
          crumb={c}
          isFirst={first && j === 0}
          isLast={last && !collapsible ? j === visible.length - 1 : false}
          key={j}
          type={group.type}
        />
      ))}
      {collapsible && (
        <button
          aria-expanded={open}
          className="text-fg-muted hover:bg-bg-tertiary border-border/40 t-sm flex w-full items-center gap-3 border-b px-3 py-1.5 text-left"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          <span className="ml-[5.75rem]">{open ? '▾' : '▸'}</span>
          {open ? (
            <span>
              collapse {group.crumbs.length} {group.type} crumbs
            </span>
          ) : (
            <span>
              {group.type} × {group.crumbs.length} — expand
            </span>
          )}
        </button>
      )}
    </div>
  )
}

function CrumbRow({
  crumb,
  isFirst,
  isLast,
  type,
}: {
  crumb: GroupableCrumb
  isFirst: boolean
  isLast: boolean
  type: string
}) {
  const dot = TYPE_DOT[type] ?? TYPE_DOT.custom!
  return (
    <div className="border-border/40 t-md flex items-baseline gap-3 border-b px-3 py-1.5 last:border-b-0">
      <span className="text-fg-muted t-sm w-16 font-mono tabular-nums">
        {crumb.timestamp.slice(11, 19)}
      </span>
      <span aria-hidden className="relative flex w-3 shrink-0 items-center self-stretch">
        {!isFirst && <span className="border-border/60 absolute inset-y-0 left-1/2 border-l" />}
        {!isLast && <span className="border-border/60 absolute inset-y-0 left-1/2 border-l" />}
        <span className={`relative h-1.5 w-1.5 rounded-full ${dot}`} />
      </span>
      <CrumbBody crumb={crumb} type={type} />
    </div>
  )
}

function CrumbBody({ crumb, type }: { crumb: GroupableCrumb; type: string }) {
  const data = crumb.data
  switch (type) {
    case 'nav': {
      const from = stringField(data, 'from')
      const to = stringField(data, 'to')
      return (
        <span className="text-fg flex-1 truncate font-mono">
          <span className="text-fg-muted">{from || '?'}</span>
          <span className="text-fg-muted mx-1">→</span>
          <span>{to || '?'}</span>
        </span>
      )
    }
    case 'net': {
      const method = stringField(data, 'method').toUpperCase()
      const url = stringField(data, 'url')
      const status = numberField(data, 'status')
      const dur = numberField(data, 'durationMs')
      const statusClass =
        status == null
          ? 'text-fg-muted'
          : status >= 500
            ? 'text-[color:var(--color-danger)]'
            : status >= 400
              ? 'text-[color:var(--color-warning)]'
              : 'text-[color:var(--color-success)]'
      return (
        <span className="text-fg flex-1 truncate font-mono">
          <span className="text-fg-muted mr-1.5">{method || 'GET'}</span>
          <span className="truncate">{url}</span>
          {status != null && <span className={`ml-2 ${statusClass}`}>{status}</span>}
          {dur != null && <span className="text-fg-muted ml-2 tabular-nums">{dur}ms</span>}
        </span>
      )
    }
    case 'log': {
      const level = stringField(data, 'level').toLowerCase()
      const msg = stringField(data, 'message')
      const lc =
        level === 'error'
          ? 'text-[color:var(--color-danger)]'
          : level === 'warn' || level === 'warning'
            ? 'text-[color:var(--color-warning)]'
            : 'text-fg-muted'
      return (
        <span className="text-fg flex-1 truncate font-mono">
          <span className={`mr-2 uppercase ${lc}`}>{level || 'log'}</span>
          <span>{msg}</span>
        </span>
      )
    }
    case 'user': {
      const action = stringField(data, 'action')
      const target = stringField(data, 'target')
      return (
        <span className="text-fg flex-1 truncate font-mono">
          <span className="text-fg-muted mr-1.5">{action || 'user'}</span>
          <span>{target}</span>
        </span>
      )
    }
    default:
      return <span className="text-fg-muted flex-1 truncate font-mono">{JSON.stringify(data)}</span>
  }
}

function stringField(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === 'string' ? v : ''
}

function numberField(data: Record<string, unknown>, key: string): null | number {
  const v = data[key]
  return typeof v === 'number' ? v : null
}
