import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router'

import {
  adminApi,
  type IssueRow,
  orgsApi,
  type SavedView,
  type SavedViewScope,
  teamsApi,
} from '@/api/client'
import { useAuth } from '@/auth/state'
import { useOrg } from '@/auth/orgContext'
import { LiveEventSparkline } from '@/components/charts'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { Tag } from '@/components/Tag'
import { EmptyArt, useToast } from '@/components/ui'
import { type ColumnDef, useColumnPrefs } from '@/lib/column-prefs'
import { densityClasses, useDensity } from '@/lib/density'
import { formatRelative } from '@/lib/format'
import { parseIssueQuery } from '@/lib/issue-query'

// Phase 24 sub-B: column visibility prefs. errorType + message are
// non-toggleable (they're the row identity); the rest can be hidden.
type IssueColumnId = 'assignee' | 'count' | 'env' | 'firstSeen' | 'lastSeen' | 'release'
const ISSUE_COLUMNS: readonly ColumnDef<IssueColumnId>[] = [
  { defaultVisible: true, id: 'count', label: 'Count' },
  { defaultVisible: true, id: 'lastSeen', label: 'Last seen' },
  { defaultVisible: false, id: 'firstSeen', label: 'First seen' },
  { defaultVisible: true, id: 'env', label: 'Env' },
  { defaultVisible: true, id: 'release', label: 'Release' },
  { defaultVisible: false, id: 'assignee', label: 'Assignee' },
]
const ISSUE_COLUMN_STORAGE_KEY = 'sentori:issues:columns:v1'

import { useUrlParam } from '@/lib/url-state'

type Status = 'active' | 'closed' | 'regressed' | 'resolved' | 'silenced'
// `regressed` lives between active and resolved in the lifecycle so it
// reads left→right naturally. Order also matches what triage tends to
// look at first.
const STATUSES: readonly Status[] = ['active', 'regressed', 'resolved', 'silenced', 'closed']

export function IssuesView() {
  const navigate = useNavigate()
  const { currentOrg, currentProject } = useOrg()
  // Phase 48 sub-C — status tab persists in `?status=`, so refresh /
  // link-share / back-button keep the user where they were.
  const [statusTab, setStatusTab] = useUrlParam<Status>('status', 'active', (raw) =>
    (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : null
  )
  // Phase 24 sub-A: single search box. Tokens like `errorType:Foo`,
  // `env:prod`, `release:myapp@1.2.3`, `status:resolved`, `last:7d`
  // map to server filter params; everything else falls through as
  // free-text matched client-side against errorType + messageSample.
  // Phase 48 sub-C — search + anr toggle persist in URL too.
  const [queryText, setQueryText] = useUrlParam<string>('q', '')
  const [anrRaw, setAnrRaw] = useUrlParam<'0' | '1'>('anr', '0', (v) => (v === '1' ? '1' : null))
  const anrOnly = anrRaw === '1'
  const toggleAnrOnly = () => setAnrRaw(anrOnly ? '0' : '1')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  // Phase 24 sub-D: multi-select for bulk actions.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Phase 50 sub-B3 — optimistic "leaving the list" animation. Rows
  // in this set render with `sentori-row-out` (slide-left + fade)
  // until the next refetch removes them from `filtered` for real.
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set())
  // Anchor index for shift-click range selection. Resets when the
  // filtered list shape changes meaningfully (status / query change),
  // since the indices wouldn't map cleanly anyway.
  const lastClickedIdxRef = useRef<null | number>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const columnsRef = useRef<HTMLDivElement>(null)
  const viewsRef = useRef<HTMLDivElement>(null)
  const {
    reset: resetColumns,
    toggle: toggleColumn,
    visible: visibleColumns,
  } = useColumnPrefs(ISSUE_COLUMN_STORAGE_KEY, ISSUE_COLUMNS)
  const { density } = useDensity()
  const dCls = densityClasses(density)

  // Close popovers on outside click — minimal, no portal.
  useEffect(() => {
    if (!columnsOpen) return
    const onDown = (e: MouseEvent) => {
      if (!columnsRef.current?.contains(e.target as Node)) setColumnsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [columnsOpen])
  useEffect(() => {
    if (!viewsOpen) return
    const onDown = (e: MouseEvent) => {
      if (!viewsRef.current?.contains(e.target as Node)) setViewsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [viewsOpen])

  // Phase 24 sub-C: saved views.
  const viewsQuery = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => orgsApi.listViews(currentOrg.slug),
    queryKey: ['saved-views', currentOrg.slug],
  })
  const applyView = (v: SavedView) => {
    setQueryText(v.payload.query ?? '')
    if (typeof v.payload.status === 'string') {
      // The parser picks `status:` from queryText if user typed one;
      // for views we surface the raw payload status in the query
      // string too, so the chip + tab render consistently.
      const q = v.payload.query ?? ''
      const hasStatus = /(^|\s)status:/.test(q)
      if (!hasStatus)
        setQueryText(q ? `${q} status:${v.payload.status}` : `status:${v.payload.status}`)
      // Tab is incidentally driven by the same parser via effectiveStatus.
    } else {
      setStatusTab('active')
    }
    setViewsOpen(false)
  }

  const projectId = currentProject?.id ?? null

  const parsed = useMemo(() => parseIssueQuery(queryText), [queryText])
  // Status tab wins over `status:` token unless the user explicitly
  // typed one; this keeps the tab UI predictable while still letting
  // power users override via query.
  const effectiveStatus: Status = parsed.status ?? statusTab

  const queryClient = useQueryClient()
  // Phase 33 sub-B: keyset pagination via useInfiniteQuery. Each page
  // returns up to PAGE_SIZE issues + an optional next cursor; an
  // IntersectionObserver near the bottom of the list triggers
  // fetchNextPage.
  const PAGE_SIZE = 100
  type IssuesPage = Awaited<ReturnType<typeof adminApi.listIssuesPage>>
  const issuesInfinite = useInfiniteQuery({
    enabled: !!projectId,
    getNextPageParam: (last: IssuesPage) => last.nextCursor ?? undefined,
    initialPageParam: null as null | string,
    queryFn: ({ pageParam }: { pageParam: null | string }) =>
      adminApi.listIssuesPage(projectId!, {
        cursor: pageParam,
        env: parsed.environment,
        errorType: parsed.errorType,
        lastSeenAfter: parsed.lastSeenAfter,
        limit: PAGE_SIZE,
        release: parsed.release,
        // Phase 44 sub-D: server-side full-text. Bare tokens in the
        // search bar (e.g. "TypeError" / "boom") flow into `search`.
        search: parsed.freeText,
        status: effectiveStatus,
      }),
    queryKey: [
      'issues',
      projectId,
      effectiveStatus,
      parsed.environment,
      parsed.release,
      parsed.errorType,
      parsed.lastSeenAfter,
      parsed.freeText ?? '',
    ],
  })
  const data = useMemo(
    () => issuesInfinite.data?.pages.flatMap((p: IssuesPage) => p.issues),
    [issuesInfinite.data]
  )
  const isLoading = issuesInfinite.isLoading
  const error = issuesInfinite.error

  const toast = useToast()
  // Phase 50 sub-B3 — wrap the mutations so they pre-flag the row
  // for the slide-out animation before firing. On success/failure
  // the set drops the id so the row either really leaves or re-
  // animates back to a normal row.
  const markResolving = (id: string) => {
    setResolvingIds((prev) => new Set(prev).add(id))
  }
  const unmarkResolving = (id: string) => {
    setResolvingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }
  const silenceMutation = useMutation({
    mutationFn: (issueId: string) =>
      adminApi.patchIssue(projectId!, issueId, { status: 'silenced' }),
    onError: (err: unknown, issueId) => {
      unmarkResolving(issueId)
      toast.error('Failed to silence issue', {
        detail: err instanceof Error ? err.message : undefined,
      })
    },
    onSuccess: (_data, issueId) => {
      toast.success('Issue silenced')
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
      unmarkResolving(issueId)
    },
  })

  const resolveMutation = useMutation({
    mutationFn: (issueId: string) =>
      adminApi.patchIssue(projectId!, issueId, { status: 'resolved' }),
    onError: (err: unknown, issueId) => {
      unmarkResolving(issueId)
      toast.error('Failed to resolve issue', {
        detail: err instanceof Error ? err.message : undefined,
      })
    },
    onSuccess: (_data, issueId) => {
      toast.success('Issue resolved')
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
      unmarkResolving(issueId)
    },
  })

  const { user } = useAuth()

  const bulkMutation = useMutation({
    mutationFn: (action: 'close' | 'reopen' | 'resolve' | 'silence') =>
      adminApi.bulkPatchIssues(projectId!, {
        action,
        issueIds: Array.from(selectedIds),
      }),
    onError: (err: unknown) =>
      toast.error('Bulk action failed', {
        detail: err instanceof Error ? err.message : undefined,
      }),
    onSuccess: (_data, variables) => {
      toast.success(
        `${variables[0]?.toUpperCase() ?? ''}${variables.slice(1)}d ${selectedIds.size} issue${selectedIds.size === 1 ? '' : 's'}`
      )
      setSelectedIds(new Set())
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })

  const bulkAssignMutation = useMutation({
    mutationFn: (assigneeUserId: null | string) =>
      adminApi.bulkPatchIssues(projectId!, {
        action: 'assign',
        assigneeUserId,
        issueIds: Array.from(selectedIds),
      }),
    onSuccess: () => {
      setSelectedIds(new Set())
      void queryClient.invalidateQueries({
        queryKey: ['issues', projectId],
      })
    },
  })

  const filtered =
    data?.filter((i) => match(i, parsed.freeText ?? '') && (!anrOnly || isAnr(i.errorType))) ?? []

  // sub-D: select-all checkbox state.
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))
  const someFilteredSelected = filtered.some((i) => selectedIds.has(i.id))

  const toggleRow = (idx: number, e: React.MouseEvent | React.ChangeEvent) => {
    const issue = filtered[idx]
    if (!issue) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      // Shift-click range: extend from last anchor to this idx.
      const shift = 'shiftKey' in (e as React.MouseEvent) && (e as React.MouseEvent).shiftKey
      if (shift && lastClickedIdxRef.current !== null) {
        const [a, b] = [lastClickedIdxRef.current, idx].sort((x, y) => x - y)
        for (let i = a; i <= b; i += 1) {
          const r = filtered[i]
          if (r) next.add(r.id)
        }
      } else {
        if (next.has(issue.id)) next.delete(issue.id)
        else next.add(issue.id)
      }
      return next
    })
    lastClickedIdxRef.current = idx
  }
  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev)
        for (const i of filtered) next.delete(i.id)
        return next
      }
      const next = new Set(prev)
      for (const i of filtered) next.add(i.id)
      return next
    })
  }

  // Clamp at render time rather than reset via effect (avoids
  // react-hooks/set-state-in-effect; selectedIdx is allowed to drift past
  // the filtered length, the safe value is what the UI consumes).
  const safeIdx = filtered.length > 0 ? Math.min(selectedIdx, filtered.length - 1) : 0

  useHotkeys('j', () => setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)), {
    enableOnFormTags: false,
  })
  useHotkeys('k', () => setSelectedIdx((i) => Math.max(i - 1, 0)), {
    enableOnFormTags: false,
  })
  useHotkeys(
    'enter',
    () => {
      const issue = filtered[safeIdx]
      if (issue) navigate(`/org/${currentOrg.slug}/issues/${issue.id}`)
    },
    { enableOnFormTags: false }
  )
  useHotkeys('/', (e) => {
    e.preventDefault()
    searchRef.current?.focus()
  })
  useHotkeys(
    's',
    () => {
      const issue = filtered[safeIdx]
      if (issue && issue.status === 'active') {
        markResolving(issue.id)
        silenceMutation.mutate(issue.id)
      }
    },
    { enableOnFormTags: false }
  )
  // Phase 23 sub-D: 'r' resolves the highlighted issue. Resolution is
  // what arms regression detection — the next event matching this
  // fingerprint flips the row to `regressed` automatically.
  useHotkeys(
    'r',
    () => {
      const issue = filtered[safeIdx]
      if (issue && (issue.status === 'active' || issue.status === 'regressed')) {
        markResolving(issue.id)
        resolveMutation.mutate(issue.id)
      }
    },
    { enableOnFormTags: false }
  )

  return (
    <div className="flex h-full flex-col">
      {/*
       * Header: single-line filter strip. Replaces the previous h-12 row.
       * Layout: title (with row count) · status chip group · spacer ·
       * live sparkline · ANR toggle · search · views menu · column menu.
       */}
      <div className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <h1 className="text-fg t-lg font-semibold">
          Issues
          {filtered.length > 0 && (
            <span className="text-fg-muted t-md ml-2 font-normal">({filtered.length})</span>
          )}
        </h1>
        <div className="ml-2 flex items-center gap-1">
          {STATUSES.map((s) => {
            const active = effectiveStatus === s
            return (
              <button
                className="cursor-pointer"
                key={s}
                onClick={() => setStatusTab(s)}
                type="button"
              >
                <Tag variant={active ? 'accent' : 'default'}>
                  <span className={active ? 'text-fg' : ''}>{s}</span>
                </Tag>
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {projectId && (
            <div className="w-48">
              <LiveEventSparkline projectId={projectId} />
            </div>
          )}
          <button
            aria-pressed={anrOnly}
            className={`t-md rounded-md px-2.5 py-1 transition-colors ${
              anrOnly
                ? 'border border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)] ring-1 ring-[color:var(--color-warning-border)]'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
            onClick={toggleAnrOnly}
            title="Show only Application Not Responding events"
            type="button"
          >
            ANR
          </button>
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent t-md w-[28rem] rounded-md border px-3 py-1 font-mono focus:ring-1 focus:outline-none"
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="errorType:Foo env:prod last:24h …  (/)"
            ref={searchRef}
            title="Tokens: errorType: env: release: status: last: (Nm/Nh/Nd). Anything else is free-text search."
            value={queryText}
          />
          <div className="relative" ref={viewsRef}>
            <button
              aria-expanded={viewsOpen}
              className="text-fg-muted hover:bg-bg-tertiary hover:text-fg t-md rounded-md px-2.5 py-1 transition-colors"
              onClick={() => setViewsOpen((v) => !v)}
              type="button"
            >
              Views{(viewsQuery.data?.length ?? 0) > 0 ? ` (${viewsQuery.data!.length})` : ''}
            </button>
            {viewsOpen && (
              <div
                className="border-border bg-bg shadow-overlay t-md absolute right-0 z-20 mt-1 w-72 rounded-md border p-2"
                role="menu"
              >
                <ViewsMenu
                  onApply={applyView}
                  onSaveCurrent={() => {
                    setSaveModalOpen(true)
                    setViewsOpen(false)
                  }}
                  views={viewsQuery.data ?? []}
                />
              </div>
            )}
          </div>
          <div className="relative" ref={columnsRef}>
            <button
              aria-expanded={columnsOpen}
              aria-label="Column settings"
              className="text-fg-muted hover:bg-bg-tertiary hover:text-fg t-md rounded-md px-2 py-1 transition-colors"
              onClick={() => setColumnsOpen((v) => !v)}
              type="button"
            >
              ⋯
            </button>
            {columnsOpen && (
              <div
                className="border-border bg-bg shadow-overlay t-md absolute right-0 z-20 mt-1 w-44 rounded-md border p-2"
                role="menu"
              >
                <div className="text-fg-muted t-sm px-1 py-1 tracking-wider uppercase">Columns</div>
                {ISSUE_COLUMNS.map((c) => (
                  <label
                    className="hover:bg-bg-tertiary flex cursor-pointer items-center gap-2 rounded px-2 py-1"
                    key={c.id}
                  >
                    <input
                      checked={visibleColumns.has(c.id)}
                      className="accent-accent"
                      onChange={() => toggleColumn(c.id)}
                      type="checkbox"
                    />
                    <span className="text-fg">{c.label}</span>
                  </label>
                ))}
                <button
                  className="text-fg-muted hover:text-fg t-sm mt-1 w-full rounded px-2 py-1 text-left"
                  onClick={resetColumns}
                  type="button"
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {parsed.warnings.length > 0 && (
        <div className="border-border t-sm border-b bg-[color:var(--color-warning-bg)] px-6 py-2 text-[color:var(--color-warning)]">
          {parsed.warnings.join(' · ')}
        </div>
      )}
      {selectedIds.size > 0 && (
        <div className="border-border bg-accent/5 t-md flex items-center gap-3 border-b px-6 py-2">
          <span className="text-fg">
            <strong className="font-mono tabular-nums">{selectedIds.size}</strong> selected
          </span>
          <span className="text-fg-muted">·</span>
          <button
            className="text-fg hover:bg-bg-tertiary rounded-md px-2 py-1"
            disabled={bulkMutation.isPending}
            onClick={() => bulkMutation.mutate('resolve')}
            type="button"
          >
            Resolve
          </button>
          <button
            className="text-fg hover:bg-bg-tertiary rounded-md px-2 py-1"
            disabled={bulkMutation.isPending}
            onClick={() => bulkMutation.mutate('silence')}
            type="button"
          >
            Silence
          </button>
          <button
            className="text-fg hover:bg-bg-tertiary rounded-md px-2 py-1"
            disabled={bulkMutation.isPending}
            onClick={() => bulkMutation.mutate('close')}
            type="button"
          >
            Close
          </button>
          <button
            className="text-fg hover:bg-bg-tertiary rounded-md px-2 py-1"
            disabled={bulkMutation.isPending}
            onClick={() => bulkMutation.mutate('reopen')}
            type="button"
          >
            Reopen
          </button>
          <span className="text-fg-muted">·</span>
          <button
            className="text-fg hover:bg-bg-tertiary rounded-md px-2 py-1"
            disabled={!user || bulkAssignMutation.isPending}
            onClick={() => user && bulkAssignMutation.mutate(user.id)}
            title="Assign selected issues to me"
            type="button"
          >
            Assign to me
          </button>
          <button
            className="text-fg hover:bg-bg-tertiary rounded-md px-2 py-1"
            disabled={bulkAssignMutation.isPending}
            onClick={() => bulkAssignMutation.mutate(null)}
            title="Clear assignee"
            type="button"
          >
            Unassign
          </button>
          <button
            className="text-fg-muted hover:text-fg ml-auto rounded-md px-2 py-1"
            onClick={() => setSelectedIds(new Set())}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}
      {saveModalOpen && (
        <SaveViewModal
          currentQuery={queryText.trim()}
          currentStatus={effectiveStatus}
          onClose={() => setSaveModalOpen(false)}
          onSaved={() => {
            setSaveModalOpen(false)
            void queryClient.invalidateQueries({
              queryKey: ['saved-views', currentOrg.slug],
            })
          }}
          orgSlug={currentOrg.slug}
        />
      )}

      {!projectId && (
        <EmptyState
          hint="Create one in your org settings to start ingesting events."
          icon={<EmptyArt kind="project" />}
          title="No project in this org yet"
        />
      )}
      {projectId && isLoading && <LoadingState />}
      {projectId && error && <ErrorState label="Failed to load issues." />}
      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          hint={
            queryText.trim()
              ? 'Try a different status tab or clear the filter.'
              : 'Trigger an error from your SDK to see it here.'
          }
          icon={<EmptyArt kind="issues" />}
          title={`No ${effectiveStatus} issues`}
        />
      )}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <table className="t-md w-full border-collapse">
            <thead className="bg-bg sticky top-0 z-10">
              <tr className="text-fg-muted border-border t-sm h-7 border-b text-left tracking-wider uppercase">
                <th className="w-9 pl-4">
                  <input
                    aria-label="Select all"
                    checked={allFilteredSelected}
                    onChange={toggleAll}
                    ref={(el) => {
                      if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected
                    }}
                    type="checkbox"
                  />
                </th>
                <th className="w-44 px-6 font-medium">Type</th>
                <th className="px-6 font-medium">Message</th>
                {visibleColumns.has('count') && (
                  <th className="w-20 px-6 text-right font-medium tabular-nums">Count</th>
                )}
                {visibleColumns.has('lastSeen') && (
                  <th className="w-32 px-6 font-medium tabular-nums">Last seen</th>
                )}
                {visibleColumns.has('firstSeen') && (
                  <th className="w-32 px-6 font-medium tabular-nums">First seen</th>
                )}
                {visibleColumns.has('env') && <th className="w-24 px-6 font-medium">Env</th>}
                {visibleColumns.has('release') && (
                  <th className="w-40 px-6 font-medium">Release</th>
                )}
                {visibleColumns.has('assignee') && (
                  <th className="w-40 px-6 font-medium">Assignee</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue, idx) => (
                <tr
                  className={`border-border/40 cursor-pointer border-b ${dCls.rowClass} ${
                    resolvingIds.has(issue.id) ? 'sentori-row-out' : ''
                  } ${
                    idx === safeIdx
                      ? 'bg-accent/10'
                      : selectedIds.has(issue.id)
                        ? 'bg-accent/5'
                        : 'hover:bg-bg-tertiary'
                  }`}
                  key={issue.id}
                  onClick={() => {
                    setSelectedIdx(idx)
                    navigate(`/org/${currentOrg.slug}/issues/${issue.id}`)
                  }}
                >
                  <td
                    className="pl-4"
                    onClick={(e) => {
                      // Eat the row navigate.
                      e.stopPropagation()
                    }}
                  >
                    <input
                      aria-label={`Select ${issue.errorType}`}
                      checked={selectedIds.has(issue.id)}
                      onChange={(e) => toggleRow(idx, e)}
                      onClick={(e) => toggleRow(idx, e)}
                      type="checkbox"
                    />
                  </td>
                  <td className="text-fg px-6 font-medium whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      {issue.errorType}
                      {isAnr(issue.errorType) && (
                        <Tag
                          variant="warning"
                          className="uppercase"
                          // Title attribute lives on the wrapping span so the
                          // hover hint still appears.
                        >
                          <span title="Application Not Responding — main thread blocked ≥ 5 s">
                            ANR
                          </span>
                        </Tag>
                      )}
                      {issue.status === 'regressed' && (
                        <Tag variant="danger" className="uppercase">
                          <span
                            title={
                              issue.regressedInRelease
                                ? `Regressed in ${issue.regressedInRelease}`
                                : 'Regressed — issue had been resolved, came back'
                            }
                          >
                            Regressed
                          </span>
                        </Tag>
                      )}
                    </span>
                  </td>
                  <td className="text-fg-muted max-w-md truncate px-6">{issue.messageSample}</td>
                  {visibleColumns.has('count') && (
                    <td className="text-fg px-6 text-right font-mono tabular-nums">
                      {issue.eventCount}
                    </td>
                  )}
                  {visibleColumns.has('lastSeen') && (
                    <td className="text-fg-muted px-6 font-mono whitespace-nowrap tabular-nums">
                      {formatRelative(issue.lastSeen)}
                    </td>
                  )}
                  {visibleColumns.has('firstSeen') && (
                    <td className="text-fg-muted px-6 font-mono whitespace-nowrap tabular-nums">
                      {formatRelative(issue.firstSeen)}
                    </td>
                  )}
                  {visibleColumns.has('env') && (
                    <td className="text-fg-muted px-6">{issue.lastEnvironment ?? '—'}</td>
                  )}
                  {visibleColumns.has('release') && (
                    <td className="text-fg-muted t-md truncate px-6 font-mono">
                      {issue.lastRelease ?? '—'}
                    </td>
                  )}
                  {visibleColumns.has('assignee') && (
                    <td className="text-fg-muted t-md truncate px-6">
                      {issue.assigneeEmail ?? '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMoreSentinel
            hasMore={issuesInfinite.hasNextPage}
            isFetching={issuesInfinite.isFetchingNextPage}
            onLoadMore={() => void issuesInfinite.fetchNextPage()}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Phase 33 sub-B: bottom-of-list sentinel that triggers
 * fetchNextPage via IntersectionObserver. Falls back to a
 * keyboard-accessible button when the observer is unavailable (older
 * browsers / a11y users tabbing in). One sentinel per IssuesView is
 * enough — react-query dedupes concurrent fetches.
 */
function LoadMoreSentinel({
  hasMore,
  isFetching,
  onLoadMore,
}: {
  hasMore: boolean
  isFetching: boolean
  onLoadMore: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hasMore || isFetching) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore()
      },
      { rootMargin: '300px' } // prefetch one viewport ahead
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isFetching, onLoadMore])

  if (!hasMore) return null
  return (
    <div className="border-border/40 flex items-center justify-center border-t py-3" ref={ref}>
      <button
        className="text-fg-muted hover:text-fg t-md"
        disabled={isFetching}
        onClick={onLoadMore}
        type="button"
      >
        {isFetching ? 'Loading…' : 'Load more'}
      </button>
    </div>
  )
}

/**
 * ANRs and iOS hangs land in the issues table with errorType
 * "ApplicationNotResponding" (Android, Phase 22 sub-D) — the same
 * string sub-E will use for iOS hangs. We pivot the badge on the
 * errorType rather than introducing a new IssueRow column so the
 * server schema doesn't change for cosmetic UI.
 */
function isAnr(errorType: string): boolean {
  return errorType === 'ApplicationNotResponding'
}

function match(issue: IssueRow, filter: string): boolean {
  if (!filter) return true
  const q = filter.toLowerCase()
  return (
    issue.errorType.toLowerCase().includes(q) ||
    issue.messageSample.toLowerCase().includes(q) ||
    (issue.lastRelease?.toLowerCase().includes(q) ?? false) ||
    (issue.lastEnvironment?.toLowerCase().includes(q) ?? false)
  )
}

function SaveViewModal({
  currentQuery,
  currentStatus,
  onClose,
  onSaved,
  orgSlug,
}: {
  currentQuery: string
  currentStatus: string
  onClose: () => void
  onSaved: () => void
  orgSlug: string
}) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState<SavedViewScope>('personal')
  const [teamSlug, setTeamSlug] = useState<string>('')
  const [error, setError] = useState<null | string>(null)

  const teamsQuery = useQuery({
    enabled: scope === 'team',
    queryFn: () => teamsApi.list(orgSlug),
    queryKey: ['teams', orgSlug],
  })

  const createMutation = useMutation({
    mutationFn: () =>
      orgsApi.createView(orgSlug, {
        name,
        payload: {
          query: currentQuery,
          status: currentStatus,
        },
        scope,
        ...(scope === 'team' ? { teamSlug } : {}),
      }),
    onError: (e: unknown) => {
      // Server responses come back as { body: { error: string }, status }.
      const body = (e as { body?: { error?: string } } | undefined)?.body
      setError(body?.error ?? 'Save failed.')
    },
    onSuccess: () => onSaved(),
  })

  const canSubmit =
    name.trim().length >= 1 && name.trim().length <= 80 && (scope !== 'team' || teamSlug.length > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="border-border bg-bg w-[28rem] rounded-md border p-4 shadow-xl">
        <h2 className="text-fg text-[14px] font-semibold">Save current view</h2>
        <p className="text-fg-muted t-sm mt-1 truncate font-mono">
          {currentQuery || `(no filter — status: ${currentStatus})`}
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <div className="text-fg-muted t-sm tracking-wider uppercase">Name</div>
            <input
              autoFocus
              className="border-border bg-bg-tertiary text-fg focus:ring-accent t-md mt-1 w-full rounded-md border px-2 py-1 focus:ring-1 focus:outline-none"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Prod high-priority"
              value={name}
            />
          </label>
          <fieldset>
            <div className="text-fg-muted t-sm tracking-wider uppercase">Scope</div>
            <div className="t-md mt-1 flex gap-3">
              {(['personal', 'team', 'org'] as const).map((s) => (
                <label className="text-fg flex items-center gap-1.5" key={s}>
                  <input
                    checked={scope === s}
                    name="view-scope"
                    onChange={() => setScope(s)}
                    type="radio"
                  />
                  {s}
                </label>
              ))}
            </div>
          </fieldset>
          {scope === 'team' && (
            <label className="block">
              <div className="text-fg-muted t-sm tracking-wider uppercase">Team</div>
              <select
                className="border-border bg-bg-tertiary text-fg t-md mt-1 w-full rounded-md border px-2 py-1"
                onChange={(e) => setTeamSlug(e.target.value)}
                value={teamSlug}
              >
                <option value="">Choose a team…</option>
                {teamsQuery.data?.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="t-md text-[color:var(--color-danger)]">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="text-fg-muted hover:text-fg t-md rounded-md px-3 py-1"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="bg-accent text-bg disabled:bg-bg-tertiary disabled:text-fg-muted t-md rounded-md px-3 py-1 disabled:cursor-not-allowed"
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            type="button"
          >
            {createMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewsMenu({
  onApply,
  onSaveCurrent,
  views,
}: {
  onApply: (v: SavedView) => void
  onSaveCurrent: () => void
  views: SavedView[]
}) {
  const groups: Record<SavedViewScope, SavedView[]> = { org: [], personal: [], team: [] }
  for (const v of views) groups[v.scope].push(v)

  return (
    <>
      <div className="text-fg-muted t-sm px-1 py-1 tracking-wider uppercase">Saved views</div>
      {views.length === 0 && (
        <p className="text-fg-muted t-md px-2 py-2">
          No saved views yet. Save the current filter to share with your team.
        </p>
      )}
      {(['org', 'team', 'personal'] as const).map((scope) =>
        groups[scope].length > 0 ? (
          <div className="border-border/50 mt-1 border-t pt-1" key={scope}>
            <div className="text-fg-muted t-sm px-2 tracking-wider uppercase">{scope}</div>
            {groups[scope].map((v) => (
              <button
                className="hover:bg-bg-tertiary block w-full rounded px-2 py-1 text-left"
                key={v.id}
                onClick={() => onApply(v)}
                type="button"
              >
                <div className="text-fg truncate">{v.name}</div>
                {v.scope === 'team' && v.teamSlug && (
                  <div className="text-fg-muted t-sm truncate">team: {v.teamSlug}</div>
                )}
                {v.payload.query && (
                  <div className="text-fg-muted t-sm truncate font-mono">{v.payload.query}</div>
                )}
              </button>
            ))}
          </div>
        ) : null
      )}
      <button
        className="border-border/50 text-accent hover:bg-bg-tertiary mt-1 block w-full rounded border-t px-2 py-1.5 pt-2 text-left"
        onClick={onSaveCurrent}
        type="button"
      >
        + Save current view…
      </button>
    </>
  )
}
