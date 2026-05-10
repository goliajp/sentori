import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { type ColumnDef, useColumnPrefs } from '@/lib/column-prefs'
import { densityClasses, useDensity } from '@/lib/density'
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

type Status = 'active' | 'closed' | 'regressed' | 'resolved' | 'silenced'
// `regressed` lives between active and resolved in the lifecycle so it
// reads left→right naturally. Order also matches what triage tends to
// look at first.
const STATUSES: readonly Status[] = ['active', 'regressed', 'resolved', 'silenced', 'closed']

export function IssuesView() {
  const navigate = useNavigate()
  const { currentOrg, currentProject } = useOrg()
  const [statusTab, setStatusTab] = useState<Status>('active')
  // Phase 24 sub-A: single search box. Tokens like `errorType:Foo`,
  // `env:prod`, `release:myapp@1.2.3`, `status:resolved`, `last:7d`
  // map to server filter params; everything else falls through as
  // free-text matched client-side against errorType + messageSample.
  const [queryText, setQueryText] = useState('')
  const [anrOnly, setAnrOnly] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [viewsOpen, setViewsOpen] = useState(false)
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  // Phase 24 sub-D: multi-select for bulk actions.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
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
  const { data, isLoading, error } = useQuery({
    enabled: !!projectId,
    queryFn: () =>
      adminApi.listIssues(projectId!, {
        env: parsed.environment,
        errorType: parsed.errorType,
        lastSeenAfter: parsed.lastSeenAfter,
        release: parsed.release,
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
    ],
  })

  const silenceMutation = useMutation({
    mutationFn: (issueId: string) =>
      adminApi.patchIssue(projectId!, issueId, { status: 'silenced' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['issues', projectId],
      })
    },
  })

  const resolveMutation = useMutation({
    mutationFn: (issueId: string) =>
      adminApi.patchIssue(projectId!, issueId, { status: 'resolved' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['issues', projectId],
      })
    },
  })

  const { user } = useAuth()

  const bulkMutation = useMutation({
    mutationFn: (action: 'close' | 'reopen' | 'resolve' | 'silence') =>
      adminApi.bulkPatchIssues(projectId!, {
        action,
        issueIds: Array.from(selectedIds),
      }),
    onSuccess: () => {
      setSelectedIds(new Set())
      void queryClient.invalidateQueries({
        queryKey: ['issues', projectId],
      })
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
        resolveMutation.mutate(issue.id)
      }
    },
    { enableOnFormTags: false }
  )

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <div className="text-fg text-base font-semibold">Issues</div>
        <div className="ml-2 flex items-center gap-1">
          {STATUSES.map((s) => (
            <button
              className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                effectiveStatus === s
                  ? 'bg-accent/10 text-accent'
                  : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
              }`}
              key={s}
              onClick={() => setStatusTab(s)}
              type="button"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            aria-pressed={anrOnly}
            className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
              anrOnly
                ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
            onClick={() => setAnrOnly((v) => !v)}
            title="Show only Application Not Responding events"
            type="button"
          >
            ANR
          </button>
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent w-[28rem] rounded-md border px-3 py-1 font-mono text-[12px] focus:ring-1 focus:outline-none"
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="errorType:Foo env:prod last:24h …  (/)"
            ref={searchRef}
            title="Tokens: errorType: env: release: status: last: (Nm/Nh/Nd). Anything else is free-text search."
            value={queryText}
          />
          <div className="relative" ref={viewsRef}>
            <button
              aria-expanded={viewsOpen}
              className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-2.5 py-1 text-[12px] transition-colors"
              onClick={() => setViewsOpen((v) => !v)}
              type="button"
            >
              Views{(viewsQuery.data?.length ?? 0) > 0 ? ` (${viewsQuery.data!.length})` : ''}
            </button>
            {viewsOpen && (
              <div
                className="border-border bg-bg shadow-overlay absolute right-0 z-20 mt-1 w-72 rounded-md border p-2 text-[12px]"
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
              className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-2 py-1 text-[12px] transition-colors"
              onClick={() => setColumnsOpen((v) => !v)}
              type="button"
            >
              ⋯
            </button>
            {columnsOpen && (
              <div
                className="border-border bg-bg shadow-overlay absolute right-0 z-20 mt-1 w-44 rounded-md border p-2 text-[12px]"
                role="menu"
              >
                <div className="text-fg-muted px-1 py-1 text-[10px] tracking-wider uppercase">
                  Columns
                </div>
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
                  className="text-fg-muted hover:text-fg mt-1 w-full rounded px-2 py-1 text-left text-[11px]"
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
        <div className="border-border bg-amber-500/5 px-6 py-2 text-[11px] text-amber-300">
          {parsed.warnings.join(' · ')}
        </div>
      )}
      {selectedIds.size > 0 && (
        <div className="border-border bg-accent/5 flex items-center gap-3 border-b px-6 py-2 text-[12px]">
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
          title={`No ${effectiveStatus} issues`}
        />
      )}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-bg sticky top-0 z-10">
              <tr className="text-fg-muted border-border h-7 border-b text-left text-[11px] tracking-wider uppercase">
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
                        <span
                          className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-300 uppercase ring-1 ring-amber-500/30"
                          title="Application Not Responding — main thread blocked ≥ 5 s"
                        >
                          ANR
                        </span>
                      )}
                      {issue.status === 'regressed' && (
                        <span
                          className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-red-300 uppercase ring-1 ring-red-500/30"
                          title={
                            issue.regressedInRelease
                              ? `Regressed in ${issue.regressedInRelease}`
                              : 'Regressed — issue had been resolved, came back'
                          }
                        >
                          Regressed
                        </span>
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
                      {relativeTime(issue.lastSeen)}
                    </td>
                  )}
                  {visibleColumns.has('firstSeen') && (
                    <td className="text-fg-muted px-6 font-mono whitespace-nowrap tabular-nums">
                      {relativeTime(issue.firstSeen)}
                    </td>
                  )}
                  {visibleColumns.has('env') && (
                    <td className="text-fg-muted px-6">{issue.lastEnvironment ?? '—'}</td>
                  )}
                  {visibleColumns.has('release') && (
                    <td className="text-fg-muted truncate px-6 font-mono text-[12px]">
                      {issue.lastRelease ?? '—'}
                    </td>
                  )}
                  {visibleColumns.has('assignee') && (
                    <td className="text-fg-muted truncate px-6 text-[12px]">
                      {issue.assigneeEmail ?? '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return d.toISOString().slice(0, 10)
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
        <p className="text-fg-muted mt-1 truncate font-mono text-[11px]">
          {currentQuery || `(no filter — status: ${currentStatus})`}
        </p>
        <div className="mt-4 space-y-3">
          <label className="block">
            <div className="text-fg-muted text-[11px] tracking-wider uppercase">Name</div>
            <input
              autoFocus
              className="border-border bg-bg-tertiary text-fg focus:ring-accent mt-1 w-full rounded-md border px-2 py-1 text-[13px] focus:ring-1 focus:outline-none"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Prod high-priority"
              value={name}
            />
          </label>
          <fieldset>
            <div className="text-fg-muted text-[11px] tracking-wider uppercase">Scope</div>
            <div className="mt-1 flex gap-3 text-[12px]">
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
              <div className="text-fg-muted text-[11px] tracking-wider uppercase">Team</div>
              <select
                className="border-border bg-bg-tertiary text-fg mt-1 w-full rounded-md border px-2 py-1 text-[13px]"
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
          {error && <p className="text-[12px] text-red-400">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="text-fg-muted hover:text-fg rounded-md px-3 py-1 text-[12px]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="bg-accent text-bg disabled:bg-bg-tertiary disabled:text-fg-muted rounded-md px-3 py-1 text-[12px] disabled:cursor-not-allowed"
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
      <div className="text-fg-muted px-1 py-1 text-[10px] tracking-wider uppercase">
        Saved views
      </div>
      {views.length === 0 && (
        <p className="text-fg-muted px-2 py-2 text-[12px]">
          No saved views yet. Save the current filter to share with your team.
        </p>
      )}
      {(['org', 'team', 'personal'] as const).map((scope) =>
        groups[scope].length > 0 ? (
          <div className="border-border/50 mt-1 border-t pt-1" key={scope}>
            <div className="text-fg-muted px-2 text-[10px] tracking-wider uppercase">{scope}</div>
            {groups[scope].map((v) => (
              <button
                className="hover:bg-bg-tertiary block w-full rounded px-2 py-1 text-left"
                key={v.id}
                onClick={() => onApply(v)}
                type="button"
              >
                <div className="text-fg truncate">{v.name}</div>
                {v.scope === 'team' && v.teamSlug && (
                  <div className="text-fg-muted truncate text-[10px]">team: {v.teamSlug}</div>
                )}
                {v.payload.query && (
                  <div className="text-fg-muted truncate font-mono text-[10px]">
                    {v.payload.query}
                  </div>
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
