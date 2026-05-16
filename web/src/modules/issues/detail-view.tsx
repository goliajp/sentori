import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link, useNavigate, useParams } from 'react-router'

import {
  type ActivityEntry,
  adminApi,
  type Breadcrumb,
  type EventRow,
  type Frame,
  type FrameSource,
  type IssueRow,
  type IssueStatus,
  type UserReport,
} from '@/api/client'
import { useAuth } from '@/auth/state'
import { useOrg } from '@/auth/orgContext'
import { AttachmentGallery } from '@/components/AttachmentGallery'
import { FrameRoleBadge } from '@/components/FrameRoleBadge'
import { SourceCode } from '@/components/SourceCode'
import { formatRelative } from '@/lib/format'
import { roleOf } from '@/lib/frame-role'
import { languageOf } from '@/lib/source-language'
import { frameToSourceUrl } from '@/lib/source-link'
import { useUrlParam } from '@/lib/url-state'

type Tab = 'activity' | 'breadcrumbs' | 'events' | 'feedback' | 'stack' | 'tags'
type WritableStatus = 'active' | 'closed' | 'resolved' | 'silenced'

const TABS: { key: Tab; label: string }[] = [
  { key: 'stack', label: 'Stack' },
  { key: 'events', label: 'Events' },
  { key: 'breadcrumbs', label: 'Breadcrumbs' },
  { key: 'tags', label: 'Tags' },
  { key: 'activity', label: 'Activity' },
  { key: 'feedback', label: 'User reports' },
]
const TAB_KEYS = new Set<Tab>(TABS.map((t) => t.key))

/**
 * Issue detail (`/org/:slug/issues/:issueId`).
 *
 * Sections (all real adminApi):
 *   • header  — back link, status text, title, error type + meta,
 *               assign / resolve-in-release actions
 *   • tabs    — Stack / Events / Breadcrumbs / Tags / Activity. Tab
 *               state lives in `?tab=` so refresh restores
 *   • event picker — `[` / `]` to walk; appears when ≥ 1 event
 *
 * v2 redesign of the v1 file (1454 LOC → ~500), keeps the data wiring
 * (issueDetail, listEvents, listReleasesForIssue, listIssueActivity,
 * patchIssue, comment create/delete). Drops v1 helpers tied to deleted
 * components (FrameRoleBadge / SourceCode / IssueInspector /
 * AttachmentGallery / ReleaseArtifactsPanel / FrameSourceDrawer /
 * MergeIssueButton / CopyMarkdownButton). These can re-land in
 * follow-ups when their replacements are designed.
 */
export function IssueDetailView() {
  const { issueId } = useParams<{ issueId: string }>()
  const { currentOrg, currentProject } = useOrg()
  const navigate = useNavigate()
  const projectId = currentProject?.id ?? null
  const qc = useQueryClient()
  const { user } = useAuth()

  const [tab, setTab] = useUrlParam<Tab>('tab', 'stack', (raw) =>
    TAB_KEYS.has(raw as Tab) ? (raw as Tab) : null
  )

  const issueQ = useQuery({
    enabled: !!projectId && !!issueId,
    queryFn: () => adminApi.issueDetail(projectId!, issueId!),
    queryKey: ['issue', projectId, issueId],
  })
  const eventsQ = useQuery({
    enabled: !!projectId && !!issueId,
    queryFn: () => adminApi.listEvents(projectId!, issueId!, { limit: 100 }),
    queryKey: ['events', projectId, issueId],
  })
  const releasesQ = useQuery({
    enabled: !!projectId && !!issueId,
    queryFn: () => adminApi.listReleasesForIssue(projectId!, issueId!),
    queryKey: ['issue-releases', projectId, issueId],
  })

  const patchM = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.patchIssue>[2]) =>
      adminApi.patchIssue(projectId!, issueId!, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['issue', projectId, issueId] })
      void qc.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })

  const events = eventsQ.data ?? []
  const [eventIdx, setEventIdx] = useState(0)
  const safeIdx = events.length > 0 ? Math.min(eventIdx, events.length - 1) : 0
  const selectedEvent = events[safeIdx]

  useHotkeys('[', () => setEventIdx((i) => Math.max(0, i - 1)))
  useHotkeys(']', () => setEventIdx((i) => Math.min(events.length - 1, i + 1)))
  useHotkeys('escape', () => navigate(`/org/${currentOrg.slug}/issues`))

  if (!issueId) return null
  if (issueQ.isLoading) return <Empty hint="Loading…" title="Issue" />
  if (issueQ.error || !issueQ.data) return <Empty hint="Failed to load." title="Issue" />

  const issue = issueQ.data

  return (
    <div className="space-y-3">
      <Link
        className="text-fg-muted hover:text-fg t-sm inline-flex items-center gap-1"
        to={`/org/${currentOrg.slug}/issues`}
      >
        ← Issues
      </Link>

      {/*
       * Two-row header. Info row sits on top with full width so a long
       * error message wraps naturally; the toolbar row sits underneath
       * with its own line of breathing room. Stacking beats the old
       * `<PageHeader actions={...}>` left/right split, which crammed
       * the assignee + Resolve / Silence / Reopen / release picker
       * against the right edge.
       */}
      <header className="space-y-2">
        <div>
          <h1 className="text-fg t-lg inline-flex flex-wrap items-baseline gap-2 font-semibold">
            <StatusText status={issue.status} />
            <span className="text-fg">{displayMessage(issue.messageSample)}</span>
          </h1>
          <div className="text-fg-muted t-md mt-1 flex flex-wrap items-baseline gap-x-2 font-mono">
            <span>{issue.errorType}</span>
            {issue.lastEnvironment && <span>· env={issue.lastEnvironment}</span>}
            {issue.lastRelease && <span>· {issue.lastRelease}</span>}
          </div>
        </div>
        <div className="border-border bg-bg-secondary/30 rounded-md border px-3 py-2">
          <IssueActions
            currentUserId={user?.id ?? null}
            issue={issue}
            onAssign={(uid) => patchM.mutate({ assigneeUserId: uid })}
            onPatchStatus={(s) => patchM.mutate({ status: s })}
            onResolveInRelease={(release) =>
              patchM.mutate({ resolvedInRelease: release, status: 'resolved' })
            }
            pending={patchM.isPending}
            releases={releasesQ.data ?? []}
          />
        </div>
      </header>

      {projectId && (
        <CulpritSection
          issueId={issueId}
          projectId={projectId}
          sourceRepoUrl={currentProject?.sourceRepoUrl ?? null}
        />
      )}

      {selectedEvent && projectId && (
        <EventGlanceStrip event={selectedEvent} projectId={projectId} />
      )}

      <Tabs current={tab} onChange={setTab} />

      {events.length > 0 && (
        <EventPicker
          events={events}
          onSelect={setEventIdx}
          selectedIdx={safeIdx}
          total={issue.eventCount}
        />
      )}

      {eventsQ.isLoading && <Empty hint="Loading events…" title="Events" />}
      {!eventsQ.isLoading && events.length === 0 && tab !== 'activity' && (
        <Empty hint="No events have landed for this issue yet." title="No events" />
      )}

      {selectedEvent && tab === 'stack' && projectId && (
        <StackTab
          event={selectedEvent}
          orgSlug={currentOrg.slug}
          projectId={projectId}
          sourceRepoUrl={currentProject?.sourceRepoUrl ?? null}
        />
      )}
      {selectedEvent && tab === 'breadcrumbs' && <BreadcrumbsTab event={selectedEvent} />}
      {selectedEvent && tab === 'tags' && <TagsTab event={selectedEvent} />}
      {events.length > 0 && tab === 'events' && (
        <EventsTab events={events} onSelect={setEventIdx} selectedIdx={safeIdx} />
      )}
      {tab === 'activity' && projectId && <ActivityTab issueId={issueId} projectId={projectId} />}
      {tab === 'feedback' && projectId && (
        <FeedbackTab issueId={issueId} projectId={projectId} />
      )}
      {selectedEvent && projectId && (
        <ReproDownloadFab eventId={selectedEvent.id} projectId={projectId} />
      )}
    </div>
  )
}

/** v0.9.2 +S5 — small button beside the event picker that downloads
 *  a Jest scaffold for the currently selected event. */
function ReproDownloadFab({ eventId, projectId }: { eventId: string; projectId: string }) {
  const onClick = () => {
    const url = `/admin/api/projects/${projectId}/events/${eventId}/repro`
    const a = document.createElement('a')
    a.href = url
    a.download = `repro-${eventId.slice(0, 8)}.test.ts`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  return (
    <div className="text-fg-muted t-sm flex justify-end">
      <button
        className="hover:text-fg t-sm flex items-center gap-1.5 font-mono"
        onClick={onClick}
        type="button"
      >
        <span className="text-accent">↓</span>
        export as jest test
      </button>
    </div>
  )
}

// ── header sub-elements ────────────────────────────────────────────────

function Tabs({ current, onChange }: { current: Tab; onChange: (t: Tab) => void }) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // ←/→ between tabs, Home/End to jump to first/last. Wraps. The
    // tablist hosts focus via a roving tabindex (only the active tab
    // is focusable) which is the WAI-ARIA pattern for tab widgets.
    const idx = TABS.findIndex((t) => t.key === current)
    if (idx < 0) return
    let next = idx
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    onChange(TABS[next]!.key)
  }
  return (
    <div
      aria-label="Issue detail sections"
      className="border-border bg-bg-tertiary/40 flex items-center gap-1 rounded-md border px-2 py-1"
      onKeyDown={onKey}
      role="tablist"
    >
      {TABS.map((t) => {
        const active = current === t.key
        return (
          <button
            aria-selected={active}
            className={`t-md focus:outline-accent rounded px-2.5 py-1 transition-colors focus:outline focus:outline-1 ${
              active
                ? 'bg-accent/10 text-accent'
                : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
            }`}
            key={t.key}
            onClick={() => onChange(t.key)}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function StatusText({ status }: { status: IssueStatus }) {
  const cls =
    status === 'active'
      ? 'text-success font-medium'
      : status === 'regressed'
        ? 'text-danger font-medium'
        : status === 'closed'
          ? 'text-fg'
          : 'text-fg-muted'
  return <span className={`t-md ${cls}`}>{status}</span>
}

function IssueActions({
  currentUserId,
  issue,
  onAssign,
  onPatchStatus,
  onResolveInRelease,
  pending,
  releases,
}: {
  currentUserId: null | string
  issue: IssueRow
  onAssign: (userId: null | string) => void
  onPatchStatus: (status: WritableStatus) => void
  onResolveInRelease: (release: null | string) => void
  pending: boolean
  releases: string[]
}) {
  const defaultRelease = issue.lastRelease ?? releases[releases.length - 1] ?? ''
  // Default captured at mount. If the user picks something else and a
  // refetch shifts the default, the picked value stays — that matches
  // user intent better than auto-reverting.
  const [release, setRelease] = useState<string>(defaultRelease)
  const releaseOptions = Array.from(new Set([defaultRelease, ...releases].filter(Boolean)))
  const isAssignedToMe = currentUserId !== null && issue.assigneeUserId === currentUserId

  return (
    <div className="text-fg-muted t-md flex flex-wrap items-center gap-2">
      {issue.assigneeEmail ? (
        <span className="text-accent" title={`Assigned to ${issue.assigneeEmail}`}>
          @{issue.assigneeEmail.split('@')[0]}
        </span>
      ) : (
        <span className="italic">unassigned</span>
      )}
      {!isAssignedToMe && currentUserId && (
        <ActionButton
          disabled={pending}
          label="Assign to me"
          onClick={() => onAssign(currentUserId)}
        />
      )}
      {issue.assigneeUserId && (
        <ActionButton disabled={pending} label="Unassign" onClick={() => onAssign(null)} />
      )}
      {issue.status !== 'resolved' && releaseOptions.length > 0 && (
        <>
          <span className="text-fg-muted">·</span>
          <span className="hidden md:inline">in</span>
          <select
            className="border-border bg-bg text-fg t-sm rounded border px-2 py-1 font-mono"
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
            className="bg-accent text-bg t-md rounded px-2.5 py-1 font-medium disabled:opacity-50"
            disabled={pending || !release}
            onClick={() => onResolveInRelease(release || null)}
            type="button"
          >
            Resolve
          </button>
        </>
      )}
      {issue.status === 'active' && (
        <ActionButton
          disabled={pending}
          label="Silence"
          onClick={() => onPatchStatus('silenced')}
        />
      )}
      {(issue.status === 'resolved' || issue.status === 'silenced') && (
        <ActionButton disabled={pending} label="Reopen" onClick={() => onPatchStatus('active')} />
      )}
    </div>
  )
}

function ActionButton({
  disabled,
  label,
  onClick,
}: {
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="border-border text-fg hover:bg-bg-tertiary t-md rounded border px-2.5 py-1 disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
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
    <div className="border-border bg-bg-tertiary/30 text-fg-muted t-md flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono tabular-nums">
      <button
        aria-label="Previous event ([)"
        className="hover:bg-bg-tertiary hover:text-fg inline-flex items-center rounded p-1 disabled:opacity-30"
        disabled={selectedIdx === 0}
        onClick={() => onSelect(Math.max(0, selectedIdx - 1))}
        title="Previous event — keyboard: ["
        type="button"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <button
        aria-label="Next event (])"
        className="hover:bg-bg-tertiary hover:text-fg inline-flex items-center rounded p-1 disabled:opacity-30"
        disabled={selectedIdx >= events.length - 1}
        onClick={() => onSelect(Math.min(events.length - 1, selectedIdx + 1))}
        title="Next event — keyboard: ]"
        type="button"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      <span className="ml-1.5">
        event {selectedIdx + 1} / {events.length}
      </span>
      <span className="text-fg-muted/70">·</span>
      <span>{total.toLocaleString()} total</span>
      {e && <span className="text-fg-muted t-sm ml-auto">{e.id.slice(0, 12)}</span>}
    </div>
  )
}

// ── tabs ────────────────────────────────────────────────────────────────

function StackTab({
  event,
  orgSlug,
  projectId,
  sourceRepoUrl,
}: {
  event: EventRow
  orgSlug: string
  projectId: string
  sourceRepoUrl?: null | string
}) {
  const payload = event.payload
  const frames = payload.error?.stack ?? []
  // Server-fetched full-file source drawer. Open one at a time; click
  // another frame to switch. Esc closes (handled inside the drawer).
  const [openFrame, setOpenFrame] = useState<null | number>(null)
  const openFrameData = openFrame !== null ? (frames[openFrame] ?? null) : null

  return (
    <div className="space-y-3">
      {event.traceId && (
        <div className="border-border bg-bg-tertiary/30 t-md flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <span className="text-fg-muted">
            Captured inside trace{' '}
            <span className="text-fg font-mono">{event.traceId.slice(0, 8)}</span>
          </span>
          <Link
            className="text-accent hover:text-accent/80 t-md whitespace-nowrap"
            to={`/org/${orgSlug}/traces/${event.traceId}`}
          >
            Open trace →
          </Link>
        </div>
      )}
      <Pane title="Stack trace">
        <StackList
          onFrameClick={(idx) => setOpenFrame(idx)}
          sourceRepoUrl={sourceRepoUrl}
          stack={frames}
        />
      </Pane>

      {/* Phase 48 sub-A.2 — screenshots / view-tree / session-trail from
       *  the SDK. Self-fetches via `/projects/:id/events/:id/attachments`,
       *  silently renders nothing when the event has no attachments. */}
      <AttachmentGallery eventId={event.id} projectId={projectId} />

      <Pane title="Context">
        <KeyValueGrid
          data={{
            'app.version': payload.app.version,
            'device.os': payload.device.os,
            'device.osVersion': payload.device.osVersion,
            ...(payload.device.model ? { 'device.model': payload.device.model } : {}),
            ...(payload.device.locale ? { 'device.locale': payload.device.locale } : {}),
            ...(payload.device.networkType
              ? { 'device.networkType': payload.device.networkType }
              : {}),
            environment: payload.environment,
            ...(payload.geo
              ? {
                  geo: [payload.geo.country, payload.geo.region, payload.geo.city]
                    .filter(Boolean)
                    .join(' · '),
                }
              : {}),
            ...(payload.flags && Object.keys(payload.flags).length > 0
              ? Object.fromEntries(
                  Object.entries(payload.flags).map(([k, v]) => [`flag:${k}`, v])
                )
              : {}),
            platform: payload.platform,
            release: payload.release,
            ...(payload.bundle
              ? {
                  bundle: payload.bundle.source
                    ? `${payload.bundle.id} (${payload.bundle.source})`
                    : payload.bundle.id,
                }
              : {}),
            'user.id': payload.user?.id ?? '(anonymous)',
          }}
        />
      </Pane>

      {openFrame !== null && (
        <FrameSourceDrawer
          environment={payload.environment}
          eventId={event.id}
          frame={openFrame}
          frameData={openFrameData}
          onClose={() => setOpenFrame(null)}
          projectId={projectId}
          sourceRepoUrl={sourceRepoUrl}
        />
      )}
    </div>
  )
}

function StackList({
  onFrameClick,
  sourceRepoUrl,
  stack,
}: {
  onFrameClick?: (idx: number) => void
  sourceRepoUrl?: null | string
  stack: Frame[]
}) {
  const [hideVendor, setHideVendor] = useState(false)
  if (stack.length === 0) {
    return <p className="text-fg-muted t-md">No frames captured.</p>
  }
  const vendorCount = stack.filter((f) => !f.inApp).length
  const visible = hideVendor ? stack.filter((f) => f.inApp) : stack
  return (
    <div>
      {vendorCount > 0 && (
        <div className="text-fg-muted t-sm mb-2 flex items-center justify-between gap-2">
          <span>
            {stack.length} frame{stack.length === 1 ? '' : 's'} ·{' '}
            <span className="font-mono">{vendorCount}</span> from libraries
          </span>
          <button
            className="text-fg-muted hover:text-fg t-sm tracking-wider uppercase"
            onClick={() => setHideVendor((v) => !v)}
            type="button"
          >
            {hideVendor ? `▸ show ${vendorCount} library` : `▾ hide library`}
          </button>
        </div>
      )}
      <div className="border-border overflow-hidden rounded-md border">
        {visible.map((f) => {
          // We always pass the ORIGINAL index from `stack` so frame
          // numbering, source drawer lookup, and `↗ src` link don't
          // shift when vendor frames are hidden.
          const idx = stack.indexOf(f)
          return (
            <FrameRow
              frame={f}
              idx={idx}
              key={idx}
              onClick={onFrameClick ? () => onFrameClick(idx) : undefined}
              sourceRepoUrl={sourceRepoUrl}
            />
          )
        })}
      </div>
    </div>
  )
}

function FrameRow({
  frame,
  idx,
  onClick,
  sourceRepoUrl,
}: {
  frame: Frame
  idx: number
  onClick?: () => void
  sourceRepoUrl?: null | string
}) {
  const hasSnippet = frame.contextLine !== undefined
  const pre = frame.preContext ?? []
  const post = frame.postContext ?? []
  const snippet = hasSnippet ? [...pre, frame.contextLine ?? '', ...post].join('\n') : ''
  const firstNo = frame.line - pre.length
  const language = languageOf(frame.file)
  const repoUrl = frameToSourceUrl({ file: frame.file, line: frame.line, sourceRepoUrl })

  return (
    <div className={`border-border/40 border-b last:border-b-0 ${frame.inApp ? 'bg-bg' : ''}`}>
      <div className="hover:bg-bg-tertiary/40 t-md flex items-baseline gap-3 px-3 py-1.5">
        <button
          aria-label="Open full source for this frame"
          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-left"
          onClick={onClick}
          type="button"
        >
          <span className="text-fg-muted t-sm w-6 shrink-0 text-right tabular-nums">{idx}</span>
          <FrameRoleBadge role={roleOf(frame)} />
          <span
            className={`min-w-0 font-mono font-semibold break-all ${
              frame.inApp ? 'text-fg' : 'text-fg-muted'
            }`}
          >
            {frame.function ?? '<anonymous>'}
          </span>
          <span className="text-fg-muted min-w-0 font-mono break-all">
            {frame.file}
            <span className="text-fg-dim">:</span>
            <span className="tabular-nums">{frame.line}</span>
            {frame.column !== undefined ? `:${frame.column}` : ''}
          </span>
        </button>
        {repoUrl && (
          <a
            aria-label="Open this line on the configured source host"
            className="text-fg-muted hover:text-fg t-sm shrink-0 self-center tracking-wider uppercase"
            href={repoUrl}
            onClick={(e) => e.stopPropagation()}
            rel="noopener noreferrer"
            target="_blank"
            title="Open on source host"
          >
            ↗ src
          </a>
        )}
      </div>
      {hasSnippet && (
        <div className="bg-bg-tertiary/20 px-3 pb-2">
          {/* Syntax-highlighted snippet via starry-night (Phase 42 sub-A.04).
           *  Highlights the throw line in red without breaking line-number
           *  alignment by passing it through `highlightLines`. */}
          <SourceCode
            code={snippet}
            highlightLines={[frame.line]}
            language={language}
            startLine={firstNo}
          />
        </div>
      )}
    </div>
  )
}

// VendorFold removed (Phase 52 follow-up): the StackList now renders
// every frame inline. Library frames stay visible by default with a
// dimmer treatment via `FrameRow`'s `inApp` branch; users who want a
// shorter view toggle "hide library" in the header above the list.

/**
 * Full-file source drawer — opened by clicking a frame in StackList.
 * Fetches via `/projects/:id/events/:id/frame-source?frame=N` with a
 * configurable context window (±5 / ±20 / ±50). Server caches each
 * window immutable + 1h so flipping is free after first fetch.
 */
function FrameSourceDrawer({
  environment,
  eventId,
  frame,
  frameData,
  onClose,
  projectId,
  sourceRepoUrl,
}: {
  environment: string
  eventId: string
  frame: number
  frameData: Frame | null
  onClose: () => void
  projectId: string
  sourceRepoUrl?: null | string
}) {
  const [contextLines, setContextLines] = useState(5)
  const { data, error, isLoading } = useQuery({
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.frameSource(projectId, eventId, { frame, lines: contextLines }),
    queryKey: ['frame-source', projectId, eventId, frame, contextLines],
    staleTime: 60 * 60 * 1000,
  })
  useHotkeys('escape', onClose, { enableOnFormTags: true })

  const repoUrl = frameData
    ? frameToSourceUrl({ file: frameData.file, line: frameData.line, sourceRepoUrl })
    : null

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
          <div className="text-fg-muted t-sm truncate tracking-wider uppercase">
            Source · frame {frame}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {[5, 20, 50].map((n) => (
              <button
                aria-label={`Show ±${n} lines`}
                className={`t-sm rounded px-2 py-0.5 transition-colors ${
                  contextLines === n
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
                }`}
                key={n}
                onClick={() => setContextLines(n)}
                type="button"
              >
                ±{n}
              </button>
            ))}
          </div>
          <button
            aria-label="Close"
            className="text-fg-muted hover:text-fg t-md rounded px-2 py-1"
            onClick={onClose}
            type="button"
          >
            ✕ Esc
          </button>
        </header>

        {/* Frame metadata — visible regardless of source availability so
         *  the user always sees function name + file:line:column + role
         *  + ↗ src external link, even when the body 404s. */}
        {frameData && (
          <div className="border-border bg-bg-secondary/30 border-b px-4 py-3">
            <div className="t-md flex items-baseline gap-2">
              <FrameRoleBadge role={roleOf(frameData)} />
              <span className="text-fg shrink-0 font-mono font-semibold">
                {frameData.function ?? '<anonymous>'}
              </span>
              {repoUrl && (
                <a
                  className="text-fg-muted hover:text-fg t-sm ml-auto shrink-0 tracking-wider uppercase"
                  href={repoUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  ↗ src
                </a>
              )}
            </div>
            <div className="text-fg-muted t-sm mt-1 truncate font-mono">
              {frameData.file}
              <span className="text-fg-dim">:</span>
              <span className="tabular-nums">{frameData.line}</span>
              {frameData.column !== undefined ? `:${frameData.column}` : ''}
              {frameData.inApp ? null : (
                <span className="text-fg-muted/70 ml-2 tracking-wider uppercase">vendor</span>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {isLoading && <p className="text-fg-muted t-md px-4 py-6">Loading source…</p>}
          {error && <FrameSourceError environment={environment} error={error} />}
          {data && <FrameSourceBody source={data} />}
        </div>
      </div>
    </div>
  )
}

function FrameSourceBody({ source }: { source: FrameSource }) {
  const offset = source.line - source.before.length
  const code = [...source.before, source.at, ...source.after].join('\n')
  const language = languageOf(source.file)
  return (
    <div className="t-md px-4 py-3">
      <p className="text-fg-muted truncate font-mono">
        {source.file}:{source.line}:{source.column}
      </p>
      <div className="border-border bg-bg-tertiary/40 mt-3 overflow-hidden rounded-md border">
        <SourceCode
          code={code}
          highlightLines={[source.line]}
          language={language}
          lineAnchorPrefix="src-"
          startLine={offset}
        />
      </div>
    </div>
  )
}

function FrameSourceError({ environment, error }: { environment: string; error: unknown }) {
  const status = (error as { status?: number } | undefined)?.status
  if (status === 404) {
    if (environment === 'dev' || environment === 'development') {
      return (
        <div className="border-info/40 bg-info/5 text-info t-md mx-4 my-4 rounded border px-3 py-2">
          <div className="t-sm mb-1 font-semibold tracking-wider uppercase">Dev build</div>
          <div className="text-fg">
            Source maps are only uploaded for production releases. Run{' '}
            <code className="font-mono">bun cli release</code> to see the original source here.
          </div>
        </div>
      )
    }
    return (
      <div className="border-warning/40 bg-warning/5 text-warning t-md mx-4 my-4 rounded border px-3 py-2">
        <div className="t-sm mb-1 font-semibold tracking-wider uppercase">No source</div>
        <div className="text-fg">
          Either the release has no source map uploaded, the bundle position can&apos;t be
          reverse-mapped, or the source map was generated without{' '}
          <code className="font-mono">sourcesContent</code>.
        </div>
      </div>
    )
  }
  return (
    <div className="border-danger/40 bg-danger/5 text-danger t-md mx-4 my-4 rounded border px-3 py-2">
      Failed to load source preview.
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
          className={`t-md block w-full px-4 py-2 text-left ${
            idx === selectedIdx ? 'bg-accent/10' : 'hover:bg-bg-tertiary/40'
          }`}
          key={e.id}
          onClick={() => onSelect(idx)}
          type="button"
        >
          <div className="flex items-baseline gap-3">
            <span className="text-fg font-mono">{e.id.slice(0, 8)}</span>
            <span className="text-fg-muted truncate">{displayMessage(e.errorMessage)}</span>
            <span className="text-fg-muted t-sm ml-auto font-mono tabular-nums">
              {formatRelative(e.receivedAt)}
            </span>
          </div>
          <div className="text-fg-muted t-sm mt-0.5 flex gap-3 font-mono">
            <span>{e.environment}</span>
            <span>{e.release}</span>
            <span>{e.platform}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

const CRUMB_COLOR: Record<Breadcrumb['type'], string> = {
  custom: 'text-fg',
  log: 'text-warning',
  nav: 'text-accent',
  net: 'text-info',
  user: 'text-fg-muted',
}

function BreadcrumbsTab({ event }: { event: EventRow }) {
  const breadcrumbs = event.payload.breadcrumbs ?? []
  if (breadcrumbs.length === 0) {
    return <Empty hint="No breadcrumbs on this event." title="Breadcrumbs" />
  }
  return (
    <div className="border-border overflow-hidden rounded-md border">
      <table className="w-full">
        <tbody>
          {breadcrumbs.map((b, i) => (
            <tr className="border-border/40 border-b last:border-b-0" key={i}>
              <td className="text-fg-muted t-sm w-28 px-3 py-1.5 font-mono tabular-nums">
                {timeOfDay(b.timestamp)}
              </td>
              <td
                className={`t-sm w-20 px-3 py-1.5 font-mono tracking-wider uppercase ${CRUMB_COLOR[b.type]}`}
              >
                {b.type}
              </td>
              <td className="text-fg t-md px-3 py-1.5">
                <pre className="text-fg font-sans whitespace-pre-wrap">{stringifyData(b.data)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TagsTab({ event }: { event: EventRow }) {
  const tags = event.payload.tags ?? {}
  const keys = Object.keys(tags)
  if (keys.length === 0) return <Empty hint="No tags on this event." title="Tags" />
  return (
    <Pane title="Tags">
      <KeyValueGrid data={tags as Record<string, unknown>} />
    </Pane>
  )
}

function ActivityTab({ issueId, projectId }: { issueId: string; projectId: string }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [draft, setDraft] = useState('')

  const activityQ = useQuery({
    queryFn: () => adminApi.listIssueActivity(projectId, issueId),
    queryKey: ['issue-activity', projectId, issueId],
  })

  const createM = useMutation({
    mutationFn: (body: string) => adminApi.createIssueComment(projectId, issueId, body),
    onSuccess: () => {
      setDraft('')
      void qc.invalidateQueries({ queryKey: ['issue-activity', projectId, issueId] })
    },
  })
  const deleteM = useMutation({
    mutationFn: (commentId: string) => adminApi.deleteIssueComment(projectId, issueId, commentId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['issue-activity', projectId, issueId] }),
  })

  const entries = activityQ.data ?? []
  const trimmed = draft.trim()
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 2000 && !createM.isPending

  return (
    <div className="space-y-3">
      <ul className="border-border divide-border divide-y overflow-hidden rounded-md border">
        {entries.length === 0 && (
          <li className="text-fg-muted t-md px-3 py-3">
            No activity yet. Comments, resolves, and regressions show up here.
          </li>
        )}
        {entries.map((e, i) => (
          <li key={i}>
            {e.kind === 'comment' ? (
              <CommentEntry
                canDelete={!!user && user.id === e.authorId}
                entry={e}
                onDelete={() => deleteM.mutate(e.id)}
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
          if (canSubmit) createM.mutate(trimmed)
        }}
      >
        <textarea
          className="border-border bg-bg-tertiary text-fg focus:border-accent t-md block w-full resize-y rounded-md border px-3 py-2 outline-none"
          maxLength={2000}
          onChange={(ev) => setDraft(ev.target.value)}
          placeholder="Leave a comment…"
          rows={3}
          value={draft}
        />
        <div className="flex items-center justify-between">
          <span className="text-fg-muted t-sm tabular-nums">{trimmed.length} / 2000</span>
          <button
            className="bg-accent text-bg t-md rounded px-3 py-1 font-medium disabled:opacity-50"
            disabled={!canSubmit}
            type="submit"
          >
            {createM.isPending ? 'Posting…' : 'Comment'}
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
      <div className="t-md flex items-baseline gap-2">
        <span className="text-fg font-medium">{entry.authorEmail ?? 'unknown'}</span>
        <span className="text-fg-muted t-sm font-mono tabular-nums">
          {formatRelative(entry.at)}
        </span>
        {canDelete && (
          <button
            className="text-fg-muted hover:text-fg t-sm ml-auto"
            onClick={onDelete}
            type="button"
          >
            Delete
          </button>
        )}
      </div>
      <p className="text-fg t-md mt-1 whitespace-pre-wrap">{entry.body}</p>
    </div>
  )
}

function StateEntry({
  entry,
}: {
  entry: Extract<ActivityEntry, { kind: 'regressed' | 'resolved' }>
}) {
  const cls = entry.kind === 'resolved' ? 'text-success' : 'text-danger'
  const label = entry.kind === 'resolved' ? 'Resolved' : 'Regressed'
  return (
    <div className="t-md flex items-baseline gap-3 px-3 py-2">
      <span className={`t-sm font-medium tracking-wide uppercase ${cls}`}>{label}</span>
      <span className="text-fg-muted t-sm font-mono tabular-nums">{formatRelative(entry.at)}</span>
      {entry.release && <span className="text-fg-muted t-md font-mono">in {entry.release}</span>}
    </div>
  )
}

// v0.9.6 #15 — compact "at a glance" strip below the culprit section.
// Single dense row pulling key dims from the selected event payload
// + a row of attachment availability badges so the operator knows
// what kinds of attached evidence exist before clicking through tabs.
function EventGlanceStrip({ event, projectId }: { event: EventRow; projectId: string }) {
  const p = event.payload
  const attachmentsQ = useQuery({
    queryFn: () => adminApi.listEventAttachments(projectId, event.id),
    queryKey: ['event-attachments', projectId, event.id],
    staleTime: 60_000,
  })
  const attachments = attachmentsQ.data ?? []
  const has = (kind: string) => attachments.some((a) => a.kind === kind)

  const dims: { label: string; value: string }[] = []
  dims.push({ label: 'release', value: p.release })
  if (p.bundle) {
    dims.push({
      label: 'bundle',
      value: p.bundle.source ? `${p.bundle.id} (${p.bundle.source})` : p.bundle.id,
    })
  }
  dims.push({ label: 'platform', value: p.platform })
  if (p.device?.os && p.device?.osVersion) {
    dims.push({ label: 'os', value: `${p.device.os} ${p.device.osVersion}` })
  }
  if (p.device?.model) {
    dims.push({ label: 'model', value: p.device.model })
  }
  if (p.device?.locale) {
    dims.push({ label: 'locale', value: p.device.locale })
  }
  if (p.device?.networkType) {
    dims.push({ label: 'net', value: p.device.networkType })
  }
  if (p.geo) {
    dims.push({
      label: 'geo',
      value: [p.geo.country, p.geo.region, p.geo.city].filter(Boolean).join(' · '),
    })
  }

  return (
    <div className="border-border bg-bg-tertiary/30 rounded-md border">
      <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-1.5">
        {dims.map((d) => (
          <span className="t-sm flex items-baseline gap-1" key={d.label}>
            <span className="text-fg-muted font-mono text-[10px]">{d.label}</span>
            <span className="text-fg font-mono">{d.value}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
        <span className="text-fg-muted t-sm font-mono">attached:</span>
        <Badge label="screenshot" present={has('screenshot')} />
        <Badge label="replay" present={has('replay')} />
        <Badge label="state" present={has('stateSnapshot')} />
        <Badge label="trail" present={has('sessionTrail')} />
        <Badge label="viewTree" present={has('viewTree')} />
        {attachmentsQ.isLoading && (
          <span className="text-fg-muted t-sm font-mono">…</span>
        )}
      </div>
    </div>
  )
}

function Badge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`t-sm rounded border px-1.5 py-[1px] font-mono text-[10px] ${
        present
          ? 'border-accent/40 text-accent bg-accent/10'
          : 'border-border text-fg-mute'
      }`}
    >
      {present ? '●' : '○'} {label}
    </span>
  )
}

// v0.9.3 +S3 — Likely Culprit section. Manual mode MVP: dashboard
// user types a commit SHA, server fetches GitHub metadata, persists
// + renders. Auto-detection (PAT + history sync) lands in v1.0.
function CulpritSection({
  issueId,
  projectId,
  sourceRepoUrl,
}: {
  issueId: string
  projectId: string
  sourceRepoUrl: null | string
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const culpritsQ = useQuery({
    queryFn: () => adminApi.listCulprits(projectId, issueId),
    queryKey: ['culprits', projectId, issueId],
  })
  const attachM = useMutation({
    mutationFn: (sha: string) => adminApi.attachCulprit(projectId, issueId, sha),
    onSuccess: () => {
      setDraft('')
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['culprits', projectId, issueId] })
    },
  })
  const detachM = useMutation({
    mutationFn: (id: string) => adminApi.detachCulprit(projectId, issueId, id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['culprits', projectId, issueId] }),
  })
  const autoM = useMutation({
    mutationFn: () => adminApi.autoDetectCulprit(projectId, issueId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['culprits', projectId, issueId] }),
  })
  const revertM = useMutation({
    mutationFn: (culpritId: string) =>
      adminApi.generateRevertPr(projectId, issueId, culpritId),
    onSuccess: (data) => {
      if (data?.prUrl) window.open(data.prUrl, '_blank', 'noopener')
    },
  })

  const culprits = culpritsQ.data ?? []
  const noRepo = !sourceRepoUrl

  if (culprits.length === 0 && !open) {
    return (
      <div className="border-border bg-bg-tertiary/30 flex items-center justify-between rounded-md border px-3 py-2">
        <span className="text-fg-muted t-sm">
          <span className="font-mono">Likely culprit:</span> unattributed
          {autoM.isError && (
            <span className="text-danger ml-3 text-[10px] font-mono">
              auto-detect failed: {String((autoM.error as Error)?.message ?? 'unknown')}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <button
            className="text-accent hover:text-fg t-sm font-mono disabled:opacity-50"
            disabled={autoM.isPending || !sourceRepoUrl}
            onClick={() => autoM.mutate()}
            title={!sourceRepoUrl ? 'Set source_repo_url first' : 'auto-detect via GitHub'}
            type="button"
          >
            {autoM.isPending ? '… scoring' : 'auto-detect'}
          </button>
          <button
            className="text-accent hover:text-fg t-sm font-mono"
            onClick={() => setOpen(true)}
            type="button"
          >
            + attach commit
          </button>
        </span>
      </div>
    )
  }

  return (
    <div className="border-border bg-bg-tertiary/30 rounded-md border">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-fg t-sm font-mono">Likely culprit</span>
        <button
          className="text-accent hover:text-fg t-sm font-mono"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? 'cancel' : '+ attach'}
        </button>
      </div>
      {open && (
        <form
          className="border-border flex items-center gap-2 border-b px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            const sha = draft.trim()
            if (sha.length < 7) return
            attachM.mutate(sha)
          }}
        >
          {noRepo ? (
            <span className="text-warning t-sm">
              Set <code className="font-mono">source_repo_url</code> in project settings first.
            </span>
          ) : (
            <>
              <input
                className="border-border bg-bg-tertiary text-fg t-sm flex-1 rounded border px-2 py-1 font-mono"
                onChange={(e) => setDraft(e.target.value)}
                placeholder="commit sha (7+ chars)"
                value={draft}
              />
              <button
                className="bg-accent text-bg t-sm rounded px-3 py-1 font-medium disabled:opacity-50"
                disabled={draft.trim().length < 7 || attachM.isPending}
                type="submit"
              >
                {attachM.isPending ? 'fetching…' : 'attach'}
              </button>
            </>
          )}
        </form>
      )}
      <ul className="divide-border divide-y">
        {culprits.map((c) => (
          <li className="flex items-baseline gap-3 px-3 py-2" key={c.id}>
            <span className="text-fg-muted font-mono text-[11px]">
              {c.commitSha.slice(0, 7)}
            </span>
            <span className="text-fg t-sm flex-1 truncate">
              {c.message ? c.message.split('\n')[0] : '(metadata fetch failed)'}
            </span>
            {c.author && (
              <span className="text-fg-muted t-sm font-mono">@{c.author}</span>
            )}
            {c.source === 'auto' && (
              <span className="text-accent text-[9px] uppercase font-mono tracking-wider">
                auto · {c.confidence}
              </span>
            )}
            {c.htmlUrl && (
              <a
                className="text-accent t-sm hover:underline"
                href={c.htmlUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                open ↗
              </a>
            )}
            <button
              className="text-accent hover:text-fg t-sm font-mono disabled:opacity-50"
              disabled={revertM.isPending}
              onClick={() => revertM.mutate(c.id)}
              type="button"
            >
              {revertM.isPending && revertM.variables === c.id ? '…' : 'revert PR'}
            </button>
            <button
              className="text-fg-muted hover:text-danger t-sm font-mono"
              onClick={() => detachM.mutate(c.id)}
              type="button"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {(autoM.isError || revertM.isError) && (
        <div className="border-border border-t px-3 py-1.5 text-[10px] text-danger font-mono">
          {autoM.isError && <>auto: {String((autoM.error as Error)?.message ?? 'unknown')}<br /></>}
          {revertM.isError && <>revert PR: {String((revertM.error as Error)?.message ?? 'unknown')}</>}
        </div>
      )}
    </div>
  )
}

// v0.8.2 — end-user-submitted bug reports tied to this issue. Read-only
// here; reports are created by the host app calling
// `sentori.sendUserFeedback({ eventId, title, body, email?, name? })`,
// which the server links to the matching event's issue automatically.
function FeedbackTab({ issueId, projectId }: { issueId: string; projectId: string }) {
  const reportsQ = useQuery({
    queryFn: () => adminApi.listUserReportsForIssue(projectId, issueId),
    queryKey: ['issue-user-reports', projectId, issueId],
  })
  const reports = reportsQ.data ?? []
  if (reportsQ.isLoading) {
    return <div className="text-fg-muted t-md px-3 py-3">Loading…</div>
  }
  if (reports.length === 0) {
    return (
      <Empty
        hint="Host app calls `sentori.sendUserFeedback({ eventId, title, body, email? })` — reports with a matching eventId land here automatically."
        title="No user reports for this issue"
      />
    )
  }
  return (
    <ul className="border-border divide-border divide-y overflow-hidden rounded-md border">
      {reports.map((r) => (
        <FeedbackEntry key={r.id} report={r} />
      ))}
    </ul>
  )
}

function FeedbackEntry({ report }: { report: UserReport }) {
  const author = report.name ?? report.email ?? 'anonymous'
  return (
    <li className="px-3 py-2">
      <div className="t-md flex items-baseline justify-between gap-2">
        <span className="text-fg font-medium">{report.title}</span>
        <span className="text-fg-muted t-sm font-mono tabular-nums">
          {formatRelative(report.receivedAt)}
        </span>
      </div>
      <div className="text-fg t-md mt-1 whitespace-pre-wrap">{report.body}</div>
      <div className="text-fg-muted t-sm mt-2 flex items-center gap-3">
        <span>{author}</span>
        {report.email && report.name && <span className="font-mono">{report.email}</span>}
        {report.eventId && (
          <span className="font-mono">event {report.eventId.slice(0, 8)}</span>
        )}
      </div>
    </li>
  )
}

// ── small helpers ──────────────────────────────────────────────────────

function Pane({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="border-border overflow-hidden rounded-md border">
      <header className="border-border border-b px-3 py-2">
        <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">{title}</span>
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  )
}

function KeyValueGrid({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== '' && v != null)
  if (entries.length === 0) {
    return <p className="text-fg-muted t-md">—</p>
  }
  return (
    <dl className="t-md grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      {entries.map(([k, v]) => (
        <div className="contents" key={k}>
          <dt className="text-fg-muted font-mono">{k}</dt>
          <dd className="text-fg font-mono break-all">{stringifyValue(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 rounded-md border px-6 py-10 text-center">
      <div className="text-fg-muted t-sm mb-1 font-semibold tracking-wider uppercase">{title}</div>
      <div className="text-fg t-md">{hint}</div>
    </div>
  )
}

/**
 * Pre-coerceError events ship the literal `[object Object]` as their
 * message. We can't recover the original payload, but we can stop
 * showing the useless string. New events ship through SDK coerceError
 * and never look like this.
 */
function displayMessage(message: string): string {
  if (!message) return '(no message)'
  if (message === '[object Object]')
    return '(non-Error thrown — SDK upgrade required to surface payload)'
  return message
}

function timeOfDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function stringifyValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function stringifyData(d: Record<string, unknown>): string {
  return Object.entries(d)
    .map(([k, v]) => `${k}=${stringifyValue(v)}`)
    .join(' ')
}
