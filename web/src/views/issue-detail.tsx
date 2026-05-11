import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link, useNavigate, useParams } from 'react-router'

import {
  type ActivityEntry,
  adminApi,
  type EventRow,
  type Frame,
  type FrameSource,
  type IssueRow,
  type SentoriError,
} from '@/api/client'
import { useAuth } from '@/auth/state'
import { useOrg } from '@/auth/orgContext'
import { ErrorState, LoadingState } from '@/components/states'
import { BreadcrumbTimeline } from './breadcrumb-timeline'

/**
 * Phase 25 sub-A: tabbed issue detail.
 *
 * Layout:
 *   [event picker bar]    ← sticky, drives `selectedEvent` for every tab
 *   [tab bar — Stack | Events | Breadcrumbs | Tags | Activity]
 *   [tab body]
 *
 * Active tab is mirrored to `location.hash` so deep links / back-button
 * round-trip cleanly. We avoid `react-router`'s `useLocation` for the
 * hash because its `hash` slice fires extra renders on routes that
 * never carry hashes — a tiny custom hook is enough.
 *
 * Data fetching is unchanged from the pre-revamp page; tabs slice the
 * same `selectedEvent.payload`. Sub-B / sub-C / sub-D / sub-E layer
 * inline source / breadcrumb timeline / related-events / activity log
 * on top of this shell.
 */

const TABS = ['stack', 'events', 'breadcrumbs', 'tags', 'activity'] as const
type Tab = (typeof TABS)[number]
const DEFAULT_TAB: Tab = 'stack'

function useTabFromHash(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>(() => parse(window.location.hash))
  useEffect(() => {
    const onHash = () => setTab(parse(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return [
    tab,
    (next: Tab) => {
      // Use replaceState so the back button moves *between issues*,
      // not between tabs of the same issue. That matches Linear /
      // Vercel — tab is a view mode, not navigation history.
      window.history.replaceState(null, '', `#${next}`)
      setTab(next)
    },
  ]
}

function parse(hash: string): Tab {
  const v = hash.replace(/^#/, '') as Tab
  return TABS.includes(v) ? v : DEFAULT_TAB
}

export function IssueDetailView() {
  const { issueId } = useParams<{ issueId: string }>()
  const navigate = useNavigate()
  const { currentOrg, currentProject } = useOrg()
  const [symbolicated, setSymbolicated] = useState(true)
  const [tab, setTab] = useTabFromHash()
  const projectId = currentProject?.id ?? null
  const issuesPath = `/org/${currentOrg.slug}/issues`

  const issueQuery = useQuery({
    enabled: !!issueId && !!projectId,
    queryFn: () => adminApi.issueDetail(projectId!, issueId!),
    queryKey: ['issue', projectId, issueId],
  })

  const eventsQuery = useQuery({
    enabled: !!issueId && !!projectId,
    queryFn: () => adminApi.listEvents(projectId!, issueId!, { limit: 100, symbolicated }),
    queryKey: ['events', projectId, issueId, symbolicated],
  })

  const releasesQuery = useQuery({
    enabled: !!issueId && !!projectId,
    queryFn: () => adminApi.listReleasesForIssue(projectId!, issueId!),
    queryKey: ['issue-releases', projectId, issueId],
  })

  const queryClient = useQueryClient()
  const { user } = useAuth()
  const patchMutation = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.patchIssue>[2]) =>
      adminApi.patchIssue(projectId!, issueId!, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issue', projectId, issueId] })
      void queryClient.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })

  const events = eventsQuery.data ?? []
  const [selectedIdx, setSelectedIdx] = useState(0)
  const safeIdx = events.length > 0 ? Math.min(selectedIdx, events.length - 1) : 0
  const selectedEvent = events[safeIdx]

  useHotkeys('[', () => setSelectedIdx((i) => Math.max(0, i - 1)))
  useHotkeys(']', () => setSelectedIdx((i) => Math.min(events.length - 1, i + 1)))
  useHotkeys('escape', () => navigate(issuesPath))

  if (!issueId) return null

  if (issueQuery.isLoading || eventsQuery.isLoading) return <LoadingState />
  if (issueQuery.error) return <ErrorState label="Failed to load issue." />

  const issue = issueQuery.data
  if (!issue) return null

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <button
          className="text-fg-muted hover:text-fg text-sm"
          onClick={() => navigate(issuesPath)}
          type="button"
        >
          ← Back
        </button>
        <h2 className="text-fg truncate text-base font-semibold">{issue.errorType}</h2>
        <span className="text-fg-muted ml-1 truncate text-sm">{issue.messageSample}</span>
        <StatusBadge issue={issue} />
        <div className="ml-auto flex items-center gap-2">
          <IssueActions
            currentUserId={user?.id ?? null}
            issue={issue}
            onAssign={(userId) => patchMutation.mutate({ assigneeUserId: userId })}
            onResolve={(release) =>
              patchMutation.mutate({
                resolvedInRelease: release,
                status: 'resolved',
              })
            }
            pending={patchMutation.isPending}
            releases={releasesQuery.data ?? []}
          />
          {events.length > 0 && (
            <EventPicker
              events={events}
              onSelect={setSelectedIdx}
              selectedIdx={safeIdx}
              total={issue.eventCount}
            />
          )}
        </div>
      </header>

      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-4">
        {TABS.map((t) => (
          <button
            className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
              tab === t
                ? 'bg-accent/10 text-accent'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
            key={t}
            onClick={() => setTab(t)}
            type="button"
          >
            {capitalise(t)}
          </button>
        ))}
      </div>

      <section className="flex-1 overflow-y-auto px-6 py-4">
        {!selectedEvent ? (
          <p className="text-fg-muted text-sm">No events for this issue yet.</p>
        ) : tab === 'stack' ? (
          <StackTab
            event={selectedEvent}
            issueId={issueId}
            onToggleSymbolicated={() => setSymbolicated((s) => !s)}
            orgSlug={currentOrg.slug}
            projectId={projectId!}
            releases={releasesQuery.data}
            symbolicated={symbolicated}
          />
        ) : tab === 'events' ? (
          <EventsTab events={events} onSelect={setSelectedIdx} selectedIdx={safeIdx} />
        ) : tab === 'breadcrumbs' ? (
          <BreadcrumbsTab event={selectedEvent} />
        ) : tab === 'tags' ? (
          <TagsTab event={selectedEvent} />
        ) : (
          <ActivityTab issueId={issueId} projectId={projectId!} />
        )}
      </section>
    </div>
  )
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function IssueActions({
  currentUserId,
  issue,
  onAssign,
  onResolve,
  pending,
  releases,
}: {
  currentUserId: null | string
  issue: IssueRow
  onAssign: (userId: null | string) => void
  onResolve: (release: null | string) => void
  pending: boolean
  releases: string[]
}) {
  // Reasonable default release for "fixed in" — the issue's last
  // known release. Caller can pick another from the dropdown if a
  // colleague already shipped a fix in a later one.
  const defaultRelease = issue.lastRelease ?? releases[releases.length - 1] ?? ''
  const [release, setRelease] = useState<string>(defaultRelease)
  const releaseOptions = Array.from(new Set([defaultRelease, ...releases].filter(Boolean)))

  const isAssignedToMe = currentUserId !== null && issue.assigneeUserId === currentUserId
  return (
    <div className="text-fg-muted flex items-center gap-2 text-[12px]">
      {issue.assigneeEmail ? (
        <span className="text-fg" title={`Assigned to ${issue.assigneeEmail}`}>
          @{issue.assigneeEmail.split('@')[0]}
        </span>
      ) : (
        <span className="italic">unassigned</span>
      )}
      {!isAssignedToMe && currentUserId && (
        <button
          className="hover:bg-bg-tertiary hover:text-fg rounded-md px-2 py-1"
          disabled={pending}
          onClick={() => onAssign(currentUserId)}
          type="button"
        >
          Assign to me
        </button>
      )}
      {issue.assigneeUserId && (
        <button
          className="hover:bg-bg-tertiary hover:text-fg rounded-md px-2 py-1"
          disabled={pending}
          onClick={() => onAssign(null)}
          type="button"
        >
          Unassign
        </button>
      )}
      {issue.status !== 'resolved' && releaseOptions.length > 0 && (
        <>
          <span>·</span>
          <span className="hidden md:inline">Resolve in</span>
          <select
            className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1 font-mono text-[11px]"
            onChange={(e) => setRelease(e.target.value)}
            value={release}
          >
            {releaseOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            className="bg-accent text-bg rounded-md px-2 py-1"
            disabled={pending || !release}
            onClick={() => onResolve(release || null)}
            type="button"
          >
            Resolve
          </button>
        </>
      )}
    </div>
  )
}

function StatusBadge({ issue }: { issue: IssueRow }) {
  const colour: Record<IssueRow['status'], string> = {
    active: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    closed: 'bg-bg-tertiary text-fg-muted ring-border',
    regressed: 'bg-red-500/15 text-red-300 ring-red-500/30',
    resolved: 'bg-green-500/15 text-green-300 ring-green-500/30',
    silenced: 'bg-bg-tertiary text-fg-muted ring-border',
  }
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ring-1 ${colour[issue.status]}`}
    >
      {issue.status}
    </span>
  )
}

function EventPicker({
  events,
  onSelect,
  selectedIdx,
  total,
}: {
  events: EventRow[]
  onSelect: (i: number) => void
  selectedIdx: number
  total: number
}) {
  const e = events[selectedIdx]
  return (
    <div className="text-fg-muted flex items-center gap-1 font-mono text-[12px] tabular-nums">
      <button
        aria-label="Previous event"
        className="hover:bg-bg-tertiary hover:text-fg rounded px-1.5 py-0.5"
        disabled={selectedIdx === 0}
        onClick={() => onSelect(Math.max(0, selectedIdx - 1))}
        type="button"
      >
        [
      </button>
      <span>
        {selectedIdx + 1} / {events.length} of {total.toLocaleString()}
      </span>
      <button
        aria-label="Next event"
        className="hover:bg-bg-tertiary hover:text-fg rounded px-1.5 py-0.5"
        disabled={selectedIdx === events.length - 1}
        onClick={() => onSelect(Math.min(events.length - 1, selectedIdx + 1))}
        type="button"
      >
        ]
      </button>
      {e && <span className="text-fg-muted ml-2 text-[11px]">{e.id.slice(0, 8)}</span>}
    </div>
  )
}

function StackTab({
  event,
  issueId,
  onToggleSymbolicated,
  orgSlug,
  projectId,
  releases,
  symbolicated,
}: {
  event: EventRow
  issueId: string
  onToggleSymbolicated: () => void
  orgSlug: string
  projectId: string
  releases: string[] | undefined
  symbolicated: boolean
}) {
  const payload = event.payload
  // Phase 25 sub-B: source drawer for the clicked frame. Coords are
  // (cause depth, frame index) so we can render across the full
  // cause-chain without re-numbering frames.
  const [openFrame, setOpenFrame] = useState<null | { cause: number; frame: number }>(null)

  return (
    <div className="space-y-6">
      <Section
        right={
          <button
            className={`rounded-md px-2 py-0.5 text-[11px] tracking-wider uppercase transition-colors ${
              symbolicated
                ? 'bg-accent/10 text-accent'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
            onClick={onToggleSymbolicated}
            type="button"
          >
            {symbolicated ? 'symbolicated' : 'raw'}
          </button>
        }
        title="Stack"
      >
        <UnsymbolicatedHint
          orgSlug={orgSlug}
          platform={payload.platform}
          projectId={projectId}
          release={event.release}
        />
        <StackList
          onFrameClick={(idx) => setOpenFrame({ cause: 0, frame: idx })}
          stack={payload.error.stack}
        />
        {payload.error.cause && (
          <CauseChain
            depth={1}
            error={payload.error.cause}
            onFrameClick={(cause, frame) => setOpenFrame({ cause, frame })}
          />
        )}
      </Section>

      {openFrame && (
        <FrameSourceDrawer
          cause={openFrame.cause}
          eventId={event.id}
          frame={openFrame.frame}
          onClose={() => setOpenFrame(null)}
          projectId={projectId}
        />
      )}

      {releases && releases.length > 0 && (
        <Section title="Releases">
          <div className="flex flex-wrap gap-2">
            {releases.map((r) => (
              <span
                className="border-border bg-bg-tertiary text-fg-muted rounded-md border px-2 py-0.5 font-mono text-[12px]"
                key={r}
              >
                {r}
              </span>
            ))}
          </div>
        </Section>
      )}

      <ReleaseArtifactsPanel projectId={projectId} release={payload.release} />

      <RelatedIssuesPanel
        currentIssueId={issueId}
        orgSlug={orgSlug}
        projectId={projectId}
        release={payload.release}
      />

      <Section title="Context">
        <KeyValueGrid
          data={{
            'app.build': payload.app.build ?? '',
            'app.framework': payload.app.framework
              ? `${payload.app.framework.name} ${payload.app.framework.version}`
              : '',
            'app.version': payload.app.version,
            'device.locale': payload.device.locale ?? '',
            'device.model': payload.device.model ?? '',
            'device.os': payload.device.os,
            'device.osVersion': payload.device.osVersion,
            environment: payload.environment,
            platform: payload.platform,
            release: payload.release,
            'user.id': payload.user?.id ?? '(anonymous)',
          }}
        />
      </Section>
    </div>
  )
}

function EventsTab({
  events,
  onSelect,
  selectedIdx,
}: {
  events: EventRow[]
  onSelect: (i: number) => void
  selectedIdx: number
}) {
  return (
    <div className="border-border divide-border divide-y overflow-hidden rounded-md border">
      {events.map((e, idx) => (
        <button
          className={`block w-full px-4 py-2 text-left text-[12px] ${
            idx === selectedIdx ? 'bg-accent/10' : 'hover:bg-bg-tertiary'
          }`}
          key={e.id}
          onClick={() => onSelect(idx)}
          type="button"
        >
          <div className="flex items-baseline gap-3">
            <span className="text-fg font-mono">{e.id.slice(0, 8)}</span>
            <span className="text-fg-muted truncate">{e.errorMessage}</span>
            <span className="text-fg-muted ml-auto font-mono text-[11px] tabular-nums">
              {relativeTime(e.receivedAt)}
            </span>
          </div>
          <div className="text-fg-muted mt-0.5 flex gap-3 font-mono text-[11px]">
            <span>{e.environment}</span>
            <span>{e.release}</span>
            <span>{e.platform}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

function BreadcrumbsTab({ event }: { event: EventRow }) {
  const breadcrumbs = event.payload.breadcrumbs ?? []
  if (breadcrumbs.length === 0) {
    return <p className="text-fg-muted text-sm">No breadcrumbs on this event.</p>
  }
  return <BreadcrumbTimeline breadcrumbs={breadcrumbs} />
}

function TagsTab({ event }: { event: EventRow }) {
  const tags = event.payload.tags ?? {}
  if (Object.keys(tags).length === 0) {
    return <p className="text-fg-muted text-sm">No tags on this event.</p>
  }
  return <KeyValueGrid data={tags} />
}

function ActivityTab({ issueId, projectId }: { issueId: string; projectId: string }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [draft, setDraft] = useState('')

  const activityQuery = useQuery({
    queryFn: () => adminApi.listIssueActivity(projectId, issueId),
    queryKey: ['issue-activity', projectId, issueId],
  })

  const createMutation = useMutation({
    mutationFn: (body: string) => adminApi.createIssueComment(projectId, issueId, body),
    onSuccess: () => {
      setDraft('')
      void queryClient.invalidateQueries({
        queryKey: ['issue-activity', projectId, issueId],
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => adminApi.deleteIssueComment(projectId, issueId, commentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['issue-activity', projectId, issueId],
      })
    },
  })

  const entries = activityQuery.data ?? []
  const trimmed = draft.trim()
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 2000 && !createMutation.isPending

  return (
    <div className="space-y-4">
      <ul className="border-border divide-border divide-y overflow-hidden rounded-md border">
        {entries.length === 0 && (
          <li className="text-fg-muted px-3 py-3 text-sm">
            No activity yet. Comments, resolves, and regressions show up here.
          </li>
        )}
        {entries.map((e, i) => (
          <li key={i}>
            {e.kind === 'comment' ? (
              <CommentEntry
                canDelete={!!user && user.id === e.authorId}
                entry={e}
                onDelete={() => deleteMutation.mutate(e.id)}
              />
            ) : (
              <StateEntry entry={e} />
            )}
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (canSubmit) createMutation.mutate(trimmed)
        }}
      >
        <textarea
          className="border-border bg-bg-tertiary text-fg focus:ring-accent block w-full resize-y rounded-md border px-3 py-2 text-[13px] focus:ring-1 focus:outline-none"
          maxLength={2000}
          onChange={(ev) => setDraft(ev.target.value)}
          placeholder="Leave a comment…"
          rows={3}
          value={draft}
        />
        <div className="flex items-center justify-between">
          <span className="text-fg-muted text-[11px] tabular-nums">{trimmed.length} / 2000</span>
          <button
            className="bg-accent text-bg disabled:bg-bg-tertiary disabled:text-fg-muted rounded-md px-3 py-1 text-[12px] disabled:cursor-not-allowed"
            disabled={!canSubmit}
            type="submit"
          >
            {createMutation.isPending ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </form>
    </div>
  )
}

function CommentEntry({
  canDelete,
  entry,
  onDelete,
}: {
  canDelete: boolean
  entry: Extract<ActivityEntry, { kind: 'comment' }>
  onDelete: () => void
}) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="text-fg font-medium">{entry.authorEmail ?? 'unknown'}</span>
        <span className="text-fg-muted font-mono tabular-nums">{relativeTime(entry.at)}</span>
        {canDelete && (
          <button
            className="text-fg-muted hover:text-fg ml-auto text-[11px]"
            onClick={onDelete}
            type="button"
          >
            Delete
          </button>
        )}
      </div>
      <p className="text-fg mt-1 text-[13px] whitespace-pre-wrap">{entry.body}</p>
    </div>
  )
}

function StateEntry({
  entry,
}: {
  entry: Extract<ActivityEntry, { kind: 'regressed' | 'resolved' }>
}) {
  const colour = entry.kind === 'resolved' ? 'text-green-300' : 'text-red-300'
  const label = entry.kind === 'resolved' ? 'Resolved' : 'Regressed'
  return (
    <div className="flex items-baseline gap-3 px-3 py-2 text-[12px]">
      <span className={`text-[10px] font-medium tracking-wide uppercase ${colour}`}>{label}</span>
      <span className="text-fg-muted font-mono tabular-nums">{relativeTime(entry.at)}</span>
      {entry.release && <span className="text-fg-muted font-mono">in {entry.release}</span>}
    </div>
  )
}

/**
 * Phase 25 sub-D: related-issues panel.
 *
 * "What else is broken right now in this release?" — pulls active
 * issues filtered by the same release, drops the issue we're already
 * looking at, and renders the top N as quick-jump links. Cheap one-
 * query implementation: server already supports `?release=` on
 * list_issues, and v0.2 one release usually has a small number of
 * active issues (≤ a few dozen). Server-side filtering by `excludeId`
 * can land if the dataset grows.
 */
function RelatedIssuesPanel({
  currentIssueId,
  orgSlug,
  projectId,
  release,
}: {
  currentIssueId: string
  orgSlug: string
  projectId: string
  release: string
}) {
  const { data, isLoading } = useQuery({
    enabled: !!release,
    queryFn: () => adminApi.listIssues(projectId, { limit: 20, release, status: 'active' }),
    queryKey: ['related-issues', projectId, release],
    staleTime: 30_000,
  })
  if (isLoading || !data) return null
  const others = data.filter((i) => i.id !== currentIssueId).slice(0, 10)
  if (others.length === 0) return null
  return (
    <Section title={`Other active issues in ${release}`}>
      <ul className="border-border divide-border divide-y overflow-hidden rounded-md border">
        {others.map((i) => (
          <li key={i.id}>
            <Link
              className="hover:bg-bg-tertiary/40 flex items-baseline gap-3 px-3 py-1.5 text-[12px]"
              to={`/org/${orgSlug}/issues/${i.id}`}
            >
              <span className="text-fg truncate font-medium whitespace-nowrap">{i.errorType}</span>
              <span className="text-fg-muted truncate">{i.messageSample}</span>
              <span className="text-fg-muted ml-auto font-mono tabular-nums">
                {i.eventCount.toLocaleString()} ev
              </span>
              <span className="text-fg-muted shrink-0 font-mono text-[11px] tabular-nums">
                {relativeTime(i.lastSeen)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/**
 * Phase 31 sub-F: when an event's release has no artifacts of the
 * relevant kind for its platform, the stack frames will be raw and
 * the most useful next action is "upload the source map / dSYM /
 * mapping." Render a banner above the stack pointing at the release
 * detail page where the upload command is shown verbatim.
 *
 * Uses the same `releaseArtifacts` query as ReleaseArtifactsPanel
 * below — react-query dedupes the network call.
 */
function UnsymbolicatedHint({
  orgSlug,
  platform,
  projectId,
  release,
}: {
  orgSlug: string
  platform: string
  projectId: string
  release: string
}) {
  const { data } = useQuery({
    enabled: !!release && !!projectId,
    queryFn: () => adminApi.releaseArtifacts(projectId, release),
    queryKey: ['release-artifacts', projectId, release],
    staleTime: 60_000,
  })
  if (!data) return null
  const needsSourcemap =
    (platform === 'javascript' || platform === 'react' || platform === 'react-native') &&
    data.sourcemaps.length === 0
  const needsDsym = platform === 'ios' && data.dsyms.length === 0
  const needsMapping = platform === 'android' && data.mappings.length === 0
  if (!needsSourcemap && !needsDsym && !needsMapping) return null

  const what = needsSourcemap ? 'source map' : needsDsym ? 'iOS dSYM' : 'ProGuard mapping'
  return (
    <div
      className="border-border bg-bg-tertiary/30 mb-3 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-[12px]"
      role="status"
    >
      <div>
        <p className="text-fg font-medium">This stack is unsymbolicated.</p>
        <p className="text-fg-muted mt-0.5">
          Upload the {what} for <span className="text-fg font-mono">{release}</span> to see original
          frames.
        </p>
      </div>
      <Link
        className="text-accent hover:text-accent/80 shrink-0 self-center text-[12px] whitespace-nowrap"
        to={`/org/${orgSlug}/releases/${encodeURIComponent(release)}`}
      >
        Open release →
      </Link>
    </div>
  )
}

/**
 * Phase 22 sub-F: read the release-artifacts summary and surface
 * what's been uploaded for the current event's release. Helps a
 * triage user spot "this stack is unsymbolicated because we never
 * uploaded the dSYM" at a glance.
 */
function ReleaseArtifactsPanel({ projectId, release }: { projectId: string; release: string }) {
  const { data, isLoading } = useQuery({
    enabled: !!release,
    queryFn: () => adminApi.releaseArtifacts(projectId, release),
    queryKey: ['release-artifacts', projectId, release],
    staleTime: 60_000,
  })
  if (isLoading || !data) return null
  const total = data.sourcemaps.length + data.dsyms.length + data.mappings.length
  if (total === 0) return null

  return (
    <Section title={`Release artifacts — ${release}`}>
      <div className="space-y-1.5 text-[12px]">
        {data.sourcemaps.length > 0 && (
          <div className="text-fg-muted">
            <span className="text-fg font-medium">Source maps:</span> {data.sourcemaps.length} file
            {data.sourcemaps.length === 1 ? '' : 's'}
          </div>
        )}
        {data.dsyms.length > 0 && (
          <div className="text-fg-muted">
            <span className="text-fg font-medium">iOS dSYMs:</span> {data.dsyms.length} slice
            {data.dsyms.length === 1 ? '' : 's'} (
            {Array.from(new Set(data.dsyms.map((d) => d.arch)))
              .sort()
              .join(', ')}
            )
          </div>
        )}
        {data.mappings.length > 0 && (
          <div className="text-fg-muted">
            <span className="text-fg font-medium">ProGuard mappings:</span> {data.mappings.length}{' '}
            upload
            {data.mappings.length === 1 ? '' : 's'} ({humanBytes(data.mappings[0]!.sizeBytes)})
          </div>
        )}
      </div>
    </Section>
  )
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function Section({
  children,
  right,
  title,
}: {
  children: ReactNode
  right?: ReactNode
  title: string
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-fg-muted text-[11px] tracking-wider uppercase">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  )
}

function StackList({
  onFrameClick,
  stack,
}: {
  onFrameClick?: (frameIdx: number) => void
  stack: Frame[]
}) {
  if (stack.length === 0) {
    return <p className="text-fg-muted text-sm">No frames.</p>
  }
  return (
    <div className="border-border overflow-hidden rounded-md border">
      {stack.map((frame, i) => (
        <button
          className={`border-border/40 hover:bg-bg-tertiary/60 flex w-full items-baseline gap-3 border-b px-3 py-1.5 text-left text-[12px] last:border-b-0 ${
            frame.inApp ? 'bg-bg' : 'bg-bg-tertiary/40 text-fg-muted'
          }`}
          key={i}
          onClick={() => onFrameClick?.(i)}
          type="button"
        >
          <span className="text-fg-muted w-6 text-right text-[11px] tabular-nums">{i}</span>
          <span className="text-fg font-mono whitespace-nowrap">
            {frame.function ?? '<anonymous>'}
          </span>
          <span className="text-fg-muted truncate font-mono">
            {frame.file}:{frame.line}
            {frame.column !== undefined ? `:${frame.column}` : ''}
          </span>
          {!frame.inApp && (
            <span className="text-fg-muted ml-auto text-[10px] uppercase">vendor</span>
          )}
        </button>
      ))}
    </div>
  )
}

function CauseChain({
  depth,
  error,
  onFrameClick,
}: {
  depth: number
  error: SentoriError
  onFrameClick?: (cause: number, frameIdx: number) => void
}) {
  return (
    <div className="border-border/40 mt-3 border-l-2 pl-3">
      <p className="text-fg text-[12px]">
        <span className="text-fg-muted">caused by</span> {error.type}: {error.message}
      </p>
      <div className="mt-2">
        <StackList onFrameClick={(i) => onFrameClick?.(depth, i)} stack={error.stack} />
      </div>
      {error.cause && (
        <CauseChain depth={depth + 1} error={error.cause} onFrameClick={onFrameClick} />
      )}
    </div>
  )
}

function FrameSourceDrawer({
  cause,
  eventId,
  frame,
  onClose,
  projectId,
}: {
  cause: number
  eventId: string
  frame: number
  onClose: () => void
  projectId: string
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => adminApi.frameSource(projectId, eventId, { cause, frame }),
    queryKey: ['frame-source', projectId, eventId, cause, frame],
  })

  // Esc closes the drawer.
  useHotkeys('escape', onClose, { enableOnFormTags: true })

  return (
    <div
      aria-modal
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col"
      role="dialog"
    >
      <div
        className="absolute inset-0 -z-10 bg-black/30"
        onClick={onClose}
        style={{ left: 'auto', right: '100%', width: '100vw' }}
      />
      <div className="border-border bg-bg flex h-full flex-col border-l shadow-xl">
        <header className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-4">
          <div className="text-fg-muted truncate text-[11px] tracking-wider uppercase">
            Source · cause {cause} · frame {frame}
          </div>
          <button
            aria-label="Close"
            className="text-fg-muted hover:text-fg ml-auto rounded-md px-2 py-1 text-[12px]"
            onClick={onClose}
            type="button"
          >
            ✕ Esc
          </button>
        </header>
        <div className="flex-1 overflow-auto">
          {isLoading && <p className="text-fg-muted px-4 py-6 text-[12px]">Loading source…</p>}
          {error && <FrameSourceError error={error} />}
          {data && <FrameSourceBody source={data} />}
        </div>
      </div>
    </div>
  )
}

function FrameSourceBody({ source }: { source: FrameSource }) {
  const offset = source.line - source.before.length
  const lines = [...source.before, source.at, ...source.after]
  return (
    <div className="px-4 py-3 text-[12px]">
      <p className="text-fg-muted truncate font-mono">
        {source.file}:{source.line}:{source.column}
      </p>
      <pre className="border-border bg-bg-tertiary/40 mt-3 overflow-x-auto rounded-md border font-mono leading-5">
        {lines.map((line, i) => {
          const ln = offset + i
          const isAt = ln === source.line
          return (
            <div
              className={`flex items-baseline gap-3 px-3 py-0.5 ${
                isAt ? 'bg-accent/10 text-fg' : 'text-fg-muted'
              }`}
              key={i}
            >
              <span className="text-fg-muted w-10 shrink-0 text-right tabular-nums">{ln}</span>
              <span className="whitespace-pre">{line || ' '}</span>
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function FrameSourceError({ error }: { error: unknown }) {
  // 404 = no sourcemap or unmapped frame; surface as a hint instead of red.
  const status = (error as { status?: number } | undefined)?.status
  if (status === 404) {
    return (
      <p className="text-fg-muted px-4 py-6 text-[12px]">
        No source available for this frame. Either the release has no source map uploaded, the
        bundle position can't be reverse-mapped, or the source map was generated without{' '}
        <code className="font-mono">sourcesContent</code>.
      </p>
    )
  }
  return <p className="px-4 py-6 text-[12px] text-red-400">Failed to load source preview.</p>
}

function KeyValueGrid({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== '' && v !== undefined)
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
      {entries.map(([k, v]) => (
        <div className="flex" key={k}>
          <span className="text-fg-muted w-32 shrink-0 truncate font-mono">{k}</span>
          <span className="text-fg truncate font-mono">{String(v)}</span>
        </div>
      ))}
    </div>
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
