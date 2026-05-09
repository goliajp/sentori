import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router'

import { adminApi, DEV_PROJECT_ID, type IssueRow } from '@/api/client'

type Status = 'active' | 'closed' | 'silenced'
const STATUSES: readonly Status[] = ['active', 'silenced', 'closed']

export function IssuesView() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('active')
  const [env, setEnv] = useState('')
  const [release, setRelease] = useState('')
  const [filter, setFilter] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryFn: () =>
      adminApi.listIssues(DEV_PROJECT_ID, {
        env: env || undefined,
        release: release || undefined,
        status,
      }),
    queryKey: ['issues', DEV_PROJECT_ID, status, env, release],
  })

  const silenceMutation = useMutation({
    mutationFn: (issueId: string) =>
      adminApi.patchIssue(DEV_PROJECT_ID, issueId, { status: 'silenced' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['issues', DEV_PROJECT_ID],
      })
    },
  })

  const filtered = data?.filter((i) => match(i, filter)) ?? []

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
      if (issue) navigate(`/issues/${issue.id}`)
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

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <div className="text-fg text-base font-semibold">Issues</div>
        <div className="ml-2 flex items-center gap-1">
          {STATUSES.map((s) => (
            <button
              className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                status === s
                  ? 'bg-accent/10 text-accent'
                  : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
              }`}
              key={s}
              onClick={() => setStatus(s)}
              type="button"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent w-24 rounded-md border px-2 py-1 text-[12px] focus:ring-1 focus:outline-none"
            onChange={(e) => setEnv(e.target.value)}
            placeholder="env"
            value={env}
          />
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent w-32 rounded-md border px-2 py-1 text-[12px] focus:ring-1 focus:outline-none"
            onChange={(e) => setRelease(e.target.value)}
            placeholder="release"
            value={release}
          />
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent w-56 rounded-md border px-3 py-1 text-[13px] focus:ring-1 focus:outline-none"
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search (/)"
            ref={searchRef}
            value={filter}
          />
        </div>
      </div>

      {isLoading && <div className="text-fg-muted px-6 py-6 text-sm">Loading…</div>}
      {error && <div className="px-6 py-6 text-sm text-red-400">Failed to load issues.</div>}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-fg-muted px-6 py-6 text-sm">
          No {status} issues{filter ? ' match the filter.' : '.'}
        </div>
      )}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-bg sticky top-0 z-10">
              <tr className="text-fg-muted border-border h-7 border-b text-left text-[11px] tracking-wider uppercase">
                <th className="w-44 px-6 font-medium">Type</th>
                <th className="px-6 font-medium">Message</th>
                <th className="w-20 px-6 text-right font-medium tabular-nums">Count</th>
                <th className="w-32 px-6 font-medium tabular-nums">Last seen</th>
                <th className="w-24 px-6 font-medium">Env</th>
                <th className="w-40 px-6 font-medium">Release</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((issue, idx) => (
                <tr
                  className={`border-border/40 h-8 cursor-pointer border-b ${
                    idx === safeIdx ? 'bg-accent/10' : 'hover:bg-bg-tertiary'
                  }`}
                  key={issue.id}
                  onClick={() => {
                    setSelectedIdx(idx)
                    navigate(`/issues/${issue.id}`)
                  }}
                >
                  <td className="text-fg px-6 font-medium whitespace-nowrap">{issue.errorType}</td>
                  <td className="text-fg-muted max-w-md truncate px-6">{issue.messageSample}</td>
                  <td className="text-fg px-6 text-right font-mono tabular-nums">
                    {issue.eventCount}
                  </td>
                  <td className="text-fg-muted px-6 font-mono whitespace-nowrap tabular-nums">
                    {relativeTime(issue.lastSeen)}
                  </td>
                  <td className="text-fg-muted px-6">{issue.lastEnvironment ?? '—'}</td>
                  <td className="text-fg-muted truncate px-6 font-mono text-[12px]">
                    {issue.lastRelease ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
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
