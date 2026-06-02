import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Link, useNavigate, useParams } from 'react-router'

import {
  type ActivityEntry,
  adminApi,
  type Breadcrumb,
  type EventRow,
  type Frame,
  type FrameSource,
  type IssuePriority,
  type IssueRow,
  type IssueStatus,
  type CrossReleaseRelatedIssue,
  type RefingerprintResponse,
  type UserReport,
} from '@/api/client'
import { useAuth } from '@/auth/state'
import { ModuleEmpty } from '@/components/Hint'
import { useOrg } from '@/auth/orgContext'
import { AttachmentGallery } from '@/components/AttachmentGallery'
import { FrameRoleBadge } from '@/components/FrameRoleBadge'
import { SourceCode } from '@/components/SourceCode'
import { ReplayTab } from './replay-tab'
import { SourceMapStatusBanner } from './source-map-status-banner'
import { LabelChip } from './triage-chips'
import { formatRelative } from '@/lib/format'
import { roleOf } from '@/lib/frame-role'
import { languageOf } from '@/lib/source-language'
import { frameToSourceUrl } from '@/lib/source-link'
import { useUrlParam } from '@/lib/url-state'
import { qk } from '@/api/query-keys'

type Tab = 'activity' | 'breadcrumbs' | 'events' | 'feedback' | 'replay' | 'stack' | 'tags'
type WritableStatus = 'active' | 'closed' | 'muted' | 'resolved' | 'silenced'

const TABS: { key: Tab; label: string }[] = [
  { key: 'stack', label: 'Stack' },
  { key: 'replay', label: 'Replay' },
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
    queryKey: qk.issue.detail(projectId, issueId),
  })
  const eventsQ = useQuery({
    enabled: !!projectId && !!issueId,
    // v2.0 — was `{ limit: 100 }`. Bumped to 500 so high-volume
    // issues (200+ events) become triage-able without cursor
    // pagination. Server cap matches at 500. See server/src/api/
    // admin/events.rs for the cap rationale + v2.1 cursor plan.
    queryFn: () => adminApi.listEvents(projectId!, issueId!, { limit: 500 }),
    queryKey: qk.issue.events(projectId, issueId),
  })
  const releasesQ = useQuery({
    enabled: !!projectId && !!issueId,
    queryFn: () => adminApi.listReleasesForIssue(projectId!, issueId!),
    queryKey: qk.issue.releases(projectId, issueId),
  })

  const patchM = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.patchIssue>[2]) =>
      adminApi.patchIssue(projectId!, issueId!, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issue.detail(projectId, issueId) })
      void qc.invalidateQueries({ queryKey: qk.issue.list(projectId) })
    },
  })

  const events = eventsQ.data ?? []
  const [eventIdx, setEventIdx] = useState(0)
  const safeIdx = events.length > 0 ? Math.min(eventIdx, events.length - 1) : 0
  const selectedEvent = events[safeIdx]

  useHotkeys('[', () => setEventIdx((i) => Math.max(0, i - 1)))
  useHotkeys(']', () => setEventIdx((i) => Math.min(events.length - 1, i + 1)))
  useHotkeys('escape', () => navigate(`/main/org/${currentOrg.slug}/issues`))

  if (!issueId) return null
  if (issueQ.isLoading) return <ModuleEmpty eyebrow="Issue">Loading…</ModuleEmpty>
  if (issueQ.error || !issueQ.data)
    return <ModuleEmpty eyebrow="Issue">Failed to load.</ModuleEmpty>

  const issue = issueQ.data

  return (
    <div className="sentori-page-in space-y-4">
      <Link
        className="inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase transition-colors hover:text-[color:var(--accent)]"
        to={`/main/org/${currentOrg.slug}/issues`}
      >
        ← back to issues
      </Link>

      {/* Header — title + meta float on the paper, no card frame.
       *  Actions sit directly below separated by a hairline so a
       *  long error message wraps cleanly. */}
      <header>
        <div className="flex items-baseline gap-3">
          <StatusText status={issue.status} />
          <span className="font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase">
            {issue.errorType}
          </span>
        </div>
        <h1
          className="mt-2 max-w-prose text-[color:var(--ink)]"
          style={{
            fontFamily: 'var(--font-sans)',
            fontVariationSettings: "'wdth' 95, 'opsz' 48, 'wght' 600",
            fontSize: 'clamp(22px, 2.6vw, 30px)',
            letterSpacing: '-0.018em',
            lineHeight: '1.14',
          }}
        >
          {displayMessage(issue.messageSample)}
        </h1>
        <div className="mt-4 border-t border-[color:var(--rule)] pt-3">
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
        <div className="mt-2">
          <TriageRow
            issue={issue}
            onSetLabels={(labels) => patchM.mutate({ labels })}
            onSetPriority={(priority) => patchM.mutate({ priority })}
            pending={patchM.isPending}
          />
        </div>
        {/* v2.4 — privacy-aware "affected users" alongside the event
         *  count. Hidden when the backend can't compute it (older
         *  list-shaped responses) or when no identified users have
         *  hit this issue yet. */}
        {issue.affectedUsers !== undefined && issue.affectedUsers > 0 && (
          <div className="mt-2 font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
            <span>{issue.eventCount.toLocaleString()} events</span>
            <span className="mx-2 text-[color:var(--rule)]">·</span>
            <span>
              {issue.affectedUsers.toLocaleString()} affected user
              {issue.affectedUsers === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {projectId && (
          <RefingerprintAdmin issueId={issue.id} projectId={projectId} title={issue.errorType} />
        )}
      </header>

      {projectId && (
        <CulpritSection
          issueId={issueId}
          projectId={projectId}
          sourceRepoUrl={currentProject?.sourceRepoUrl ?? null}
        />
      )}

      {projectId && <LinkedIssuesPanel issueId={issueId} projectId={projectId} />}

      {projectId && (
        <RelatedAcrossReleasesPanel
          currentOrgSlug={currentOrg.slug}
          issueId={issueId}
          projectId={projectId}
        />
      )}

      {selectedEvent && projectId && (
        <EventGlanceStrip event={selectedEvent} projectId={projectId} />
      )}

      <Tabs current={tab} onChange={setTab} />

      {eventsQ.isLoading && <ModuleEmpty eyebrow="Events">Loading events…</ModuleEmpty>}
      {!eventsQ.isLoading && events.length === 0 && tab !== 'activity' && (
        <ModuleEmpty eyebrow="No events">No events have landed for this issue yet.</ModuleEmpty>
      )}

      {/* v1.1 #ux: 3-pane content area on lg+.
       *  Left rail: events list (scrollable, sticky on lg).
       *  Right: tab content. The Stack tab itself splits into a
       *  further 2-column grid on xl+ (text on left, visuals on
       *  right) so a 1440px screen no longer wastes its horizontal
       *  budget. */}
      {events.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
          <EventsRail
            events={events}
            onSelect={setEventIdx}
            selectedIdx={safeIdx}
            total={issue.eventCount}
          />
          <div className="min-w-0 space-y-3">
            {selectedEvent && tab === 'stack' && projectId && (
              <StackTab
                event={selectedEvent}
                orgSlug={currentOrg.slug}
                projectId={projectId}
                sourceRepoUrl={currentProject?.sourceRepoUrl ?? null}
              />
            )}
            {selectedEvent && tab === 'replay' && projectId && (
              <ReplayTab eventId={selectedEvent.id} projectId={projectId} />
            )}
            {selectedEvent && tab === 'breadcrumbs' && <BreadcrumbsTab event={selectedEvent} />}
            {selectedEvent && tab === 'tags' && <TagsTab event={selectedEvent} />}
            {tab === 'events' && (
              <EventsTab events={events} onSelect={setEventIdx} selectedIdx={safeIdx} />
            )}
            {tab === 'activity' && projectId && (
              <ActivityTab issueId={issueId} projectId={projectId} />
            )}
            {tab === 'feedback' && projectId && (
              <FeedbackTab issueId={issueId} projectId={projectId} />
            )}
          </div>
        </div>
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
    let next: number
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
      className="flex items-baseline gap-5 border-b border-[color:var(--rule)] pb-px"
      onKeyDown={onKey}
      role="tablist"
    >
      {TABS.map((t) => {
        const active = current === t.key
        return (
          <button
            aria-selected={active}
            className={`relative pb-2 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors focus:outline-none ${
              active
                ? 'text-[color:var(--ink)]'
                : 'text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]'
            }`}
            key={t.key}
            onClick={() => onChange(t.key)}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            {t.label}
            {active && (
              <span
                aria-hidden
                className="absolute right-0 -bottom-px left-0 h-[2px] bg-[color:var(--accent)]"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

function StatusText({ status }: { status: IssueStatus }) {
  const tone =
    status === 'active'
      ? 'text-[color:var(--danger)]'
      : status === 'regressed'
        ? 'text-[color:var(--danger)]'
        : status === 'resolved'
          ? 'text-[color:var(--success)]'
          : 'text-[color:var(--ink-muted)]'
  return (
    <span className={`font-mono text-[10px] tracking-[0.22em] uppercase ${tone}`}>{status}</span>
  )
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
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--ink-soft)]">
      {issue.assigneeEmail ? (
        <span
          className="font-mono text-[color:var(--accent)]"
          title={`Assigned to ${issue.assigneeEmail}`}
        >
          @{issue.assigneeEmail.split('@')[0]}
        </span>
      ) : (
        <span className="font-mono text-[11px] text-[color:var(--ink-muted)] italic">
          unassigned
        </span>
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
          <span aria-hidden className="text-[color:var(--ink-muted)]">
            ·
          </span>
          <span className="hidden font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase md:inline">
            in
          </span>
          <select
            className="h-7 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[11px] text-[color:var(--ink)] transition-colors hover:border-[color:var(--accent)] focus:border-[color:var(--accent)] focus:outline-none"
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
            className="inline-flex h-7 items-center bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
      {issue.status === 'active' && (
        <ActionButton disabled={pending} label="Mute" onClick={() => onPatchStatus('muted')} />
      )}
      {(issue.status === 'resolved' || issue.status === 'silenced' || issue.status === 'muted') && (
        <ActionButton disabled={pending} label="Reopen" onClick={() => onPatchStatus('active')} />
      )}
      <WatchToggle issueId={issue.id} />
      <MuteToggle issueId={issue.id} />
    </div>
  )
}

// v1.2 W7.a — Linked external issues panel. Shows one row per
// integration_kind (linear/github/gitlab/jira) with the
// denormalised title + status + last-updated. Server refreshes those
// fields via inbound webhooks; this panel just renders.
function LinkedIssuesPanel({ issueId, projectId }: { issueId: string; projectId: string }) {
  const linksQ = useQuery({
    queryFn: () => adminApi.listIntegrationLinks(projectId, issueId),
    queryKey: ['integration-links', projectId, issueId],
    staleTime: 60_000,
  })
  const links = linksQ.data ?? []
  if (links.length === 0) return null
  return (
    <div className="border-border bg-bg-tertiary/30 rounded-md border">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <span className="text-fg t-sm font-mono">Linked issues</span>
      </div>
      <ul className="divide-border divide-y">
        {links.map((l) => (
          <li
            className="flex items-baseline gap-3 px-3 py-2"
            key={`${l.integrationKind}-${l.externalId}`}
          >
            <span className="text-fg-muted font-mono text-[10px] tracking-wider uppercase">
              {l.integrationKind}
            </span>
            <span className="text-fg t-sm flex-1 truncate">{l.externalTitle ?? l.externalId}</span>
            {l.externalStatus && (
              <span className="text-fg-muted t-sm font-mono">{l.externalStatus}</span>
            )}
            {l.externalUrl && (
              <a
                className="text-accent hover:text-accent-strong t-sm font-mono"
                href={l.externalUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// v1.2 W8 — per-issue Watch toggle. Subscribes the caller to the
// notifications feed for this issue's mutations. Idempotent: re-clicking
// toggles between watching ↔ not watching.
function WatchToggle({ issueId }: { issueId: string }) {
  const { projectId } = useParams<{ projectId?: string }>()
  const params = useParams<{ projectId?: string }>()
  const pid = params.projectId ?? null
  const resolvedProjectId = projectId ?? pid
  const qc = useQueryClient()
  const watchQ = useQuery({
    enabled: !!resolvedProjectId,
    queryFn: () => adminApi.watchStatus(resolvedProjectId!, issueId),
    queryKey: qk.watchStatus(resolvedProjectId ?? '', issueId),
  })
  const toggle = useMutation({
    mutationFn: () =>
      watchQ.data?.watching
        ? adminApi.unwatchIssue(resolvedProjectId!, issueId)
        : adminApi.watchIssue(resolvedProjectId!, issueId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.watchStatus(resolvedProjectId ?? '', issueId) }),
  })
  if (!resolvedProjectId) return null
  const watching = watchQ.data?.watching ?? false
  return (
    <ActionButton
      disabled={toggle.isPending}
      label={watching ? '✓ Watching' : 'Watch'}
      onClick={() => toggle.mutate()}
    />
  )
}

// v1.4 W18 — per-issue mute toggle. Independent of the W14 per-kind
// global mute: an operator can be muted on this one issue (e.g.
// "this thing fires every 30s, stop pinging me") while still
// receiving notifications for other issues of the same kind.
function MuteToggle({ issueId }: { issueId: string }) {
  const params = useParams<{ projectId?: string }>()
  const resolvedProjectId = params.projectId ?? null
  const qc = useQueryClient()
  const watchQ = useQuery({
    enabled: !!resolvedProjectId,
    queryFn: () => adminApi.watchStatus(resolvedProjectId!, issueId),
    queryKey: qk.watchStatus(resolvedProjectId ?? '', issueId),
  })
  const toggle = useMutation({
    mutationFn: () =>
      watchQ.data?.muted
        ? adminApi.unmuteIssue(resolvedProjectId!, issueId)
        : adminApi.muteIssue(resolvedProjectId!, issueId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.watchStatus(resolvedProjectId ?? '', issueId) }),
  })
  if (!resolvedProjectId) return null
  const muted = watchQ.data?.muted ?? false
  return (
    <ActionButton
      disabled={toggle.isPending}
      label={muted ? '🔕 Muted' : 'Mute'}
      onClick={() => toggle.mutate()}
    />
  )
}

// v1.2 W4 — priority dropdown + label chips inline editor. Kept
// compact: the issue rail already conveys priority+labels, so the
// detail row mostly serves as the *edit* surface.
function TriageRow({
  issue,
  onSetLabels,
  onSetPriority,
  pending,
}: {
  issue: IssueRow
  onSetLabels: (labels: string[]) => void
  onSetPriority: (priority: IssuePriority) => void
  pending: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const submitDraft = () => {
    const v = draft.trim()
    if (!v) {
      setAdding(false)
      setDraft('')
      return
    }
    if (issue.labels.includes(v)) {
      setAdding(false)
      setDraft('')
      return
    }
    onSetLabels([...issue.labels, v])
    setDraft('')
    setAdding(false)
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-[color:var(--ink-soft)]">
      <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        priority
      </span>
      <select
        className="h-7 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[11px] text-[color:var(--ink)] transition-colors hover:border-[color:var(--accent)] focus:border-[color:var(--accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending}
        onChange={(e) => onSetPriority(e.target.value as IssuePriority)}
        value={issue.priority}
      >
        <option value="p0">p0 — pager</option>
        <option value="p1">p1 — high</option>
        <option value="p2">p2 — medium</option>
        <option value="p3">p3 — backlog</option>
      </select>
      <span aria-hidden className="text-[color:var(--ink-muted)]">
        ·
      </span>
      <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        labels
      </span>
      {issue.labels.map((l) => (
        <LabelChip
          key={l}
          label={l}
          onRemove={() => onSetLabels(issue.labels.filter((x) => x !== l))}
        />
      ))}
      {adding ? (
        <input
          autoFocus
          className="h-7 border border-[color:var(--accent)] bg-[color:var(--paper-2)] px-2 font-mono text-[11px] text-[color:var(--ink)] focus:outline-none"
          disabled={pending}
          onBlur={submitDraft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitDraft()
            if (e.key === 'Escape') {
              setAdding(false)
              setDraft('')
            }
          }}
          placeholder="label"
          value={draft}
        />
      ) : (
        <ActionButton disabled={pending} label="+ label" onClick={() => setAdding(true)} />
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
      className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2.5 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  )
}

/** v1.1 #ux — vertical events sidebar that replaced the chevron-only
 *  picker. Each row carries release / time / env so the operator can
 *  scan-and-click instead of blind-walking with [ and ]. Hotkeys
 *  still work; the rail just makes them optional.
 *
 *  Scrolls independently on lg+ (sticky to the top of the detail
 *  scroll area), max-h `calc(100vh - 240px)` so it doesn't overlap
 *  the page header. Keeps the selected row in view via scrollIntoView. */
function EventsRail({
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
  const listRef = useRef<HTMLUListElement | null>(null)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-event-idx="${selectedIdx}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedIdx])

  return (
    <aside className="lg:sticky lg:top-3 lg:max-h-[calc(100vh-220px)]">
      <header className="flex items-baseline justify-between border-b border-[color:var(--rule)] pb-2 font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        <span>
          events <span className="text-[color:var(--ink)] tabular-nums">{events.length}</span>
          {/* v2.0 — explicit hint when fetch capped below total so
           *  triage doesn't silently miss older events. Cursor
           *  pagination is the v2.1 fix; until then this is the
           *  honest signal that some events aren't loaded. */}
          {events.length >= 500 && total > events.length && (
            <span className="ml-1 text-[color:var(--warning)] normal-case">
              (capped — {total - events.length} older not loaded)
            </span>
          )}
        </span>
        <span>{total.toLocaleString()} total</span>
      </header>
      <ul
        className="divide-y divide-[color:var(--rule-soft)] overflow-y-auto"
        ref={listRef}
        style={{ maxHeight: 'calc(100vh - 260px)' }}
      >
        {events.map((e, idx) => {
          const active = idx === selectedIdx
          return (
            <li data-event-idx={idx} key={e.id}>
              <button
                aria-current={active ? 'true' : undefined}
                className={`block w-full px-2 py-2 text-left transition-colors ${
                  active
                    ? 'border-l-2 border-[color:var(--accent)] bg-[color:var(--accent)]/8'
                    : 'border-l-2 border-transparent hover:bg-[color:var(--paper-2)]'
                }`}
                onClick={() => onSelect(idx)}
                type="button"
              >
                <div className="flex items-baseline justify-between gap-2 font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)] tabular-nums">
                  <span className={active ? 'text-[color:var(--accent)]' : ''}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span>{formatRelative(e.receivedAt)}</span>
                </div>
                <div
                  className={`mt-1 truncate font-mono text-[11px] ${
                    active ? 'text-[color:var(--ink)]' : 'text-[color:var(--ink-soft)]'
                  }`}
                  title={e.release}
                >
                  {e.release}
                </div>
                <div className="mt-0.5 flex items-baseline gap-2 font-mono text-[9px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
                  <span>{e.environment}</span>
                  <span className="opacity-60">·</span>
                  <span>{e.platform}</span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
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
      <SourceMapStatusBanner
        platform={event.platform}
        projectId={projectId}
        release={event.release}
      />
      {event.traceId && (
        <div className="flex items-center justify-between gap-3 border-y border-[color:var(--rule)] py-2 text-[13px]">
          <span className="text-[color:var(--ink-soft)]">
            Captured inside trace{' '}
            <span className="font-mono text-[color:var(--ink)]">{event.traceId.slice(0, 8)}</span>
          </span>
          <Link
            className="font-mono text-[10px] tracking-[0.18em] whitespace-nowrap text-[color:var(--accent)] uppercase hover:text-[color:var(--accent-strong)]"
            to={`/main/org/${orgSlug}/traces/${event.traceId}`}
          >
            open trace →
          </Link>
        </div>
      )}

      {/* v1.1 #ux: Stack tab content splits into two columns on xl+.
       *  Left: text content (Error body, Stack frames) — read flow.
       *  Right: visual context (screenshot, replay, view tree,
       *  state snapshot) — what the user was looking at.
       *  Below xl, falls back to single column with text first then
       *  visuals so the read flow is preserved on narrow screens. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 xl:grid-cols-2 xl:items-start">
        <div className="min-w-0 space-y-3">
          <ErrorBodyPane event={event} />
          <Pane title="Stack trace">
            <StackList
              onFrameClick={(idx) => setOpenFrame(idx)}
              sourceRepoUrl={sourceRepoUrl}
              stack={frames}
            />
          </Pane>
        </div>
        <div className="min-w-0">
          <AttachmentGallery
            eventContext={<DebugCenterEventContext event={event} />}
            eventId={event.id}
            projectId={projectId}
          />
        </div>
      </div>

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
    return (
      <p className="border-y border-[color:var(--rule)] py-3 text-[13px] text-[color:var(--ink-soft)]">
        No frames captured.
      </p>
    )
  }
  const vendorCount = stack.filter((f) => !f.inApp).length
  const visible = hideVendor ? stack.filter((f) => f.inApp) : stack
  return (
    <div>
      {vendorCount > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
          <span>
            {stack.length} frame{stack.length === 1 ? '' : 's'} ·{' '}
            <span className="text-[color:var(--ink-soft)]">{vendorCount}</span> from libraries
          </span>
          <button
            className="font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase transition-colors hover:text-[color:var(--accent)]"
            onClick={() => setHideVendor((v) => !v)}
            type="button"
          >
            {hideVendor ? `▸ show ${vendorCount} library` : `▾ hide library`}
          </button>
        </div>
      )}
      <div className="overflow-hidden border-y border-[color:var(--rule)]">
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
      {!hasSnippet && frame.inApp && <NoSourceHint file={frame.file} />}
    </div>
  )
}

// v1.2 W2.b — single-line "no source" hint below in-app frames with
// no inline snippet. Heuristic per file extension to explain WHY
// without making the operator click into the drawer. Only renders on
// inApp frames — vendor frames are correctly minified for a different
// reason (we don't upload sourcemaps for `node_modules`).
function NoSourceHint({ file }: { file: string }) {
  const lower = file.toLowerCase()
  let copy: string
  if (
    lower.endsWith('.swift') ||
    lower.endsWith('.m') ||
    lower.endsWith('.mm') ||
    lower.endsWith('.h') ||
    lower.endsWith('.hpp')
  ) {
    copy = 'native frame — upload an iOS source bundle to view source'
  } else if (lower.endsWith('.kt') || lower.endsWith('.java')) {
    copy = 'native frame — upload an Android source bundle to view source'
  } else if (
    lower.endsWith('.ts') ||
    lower.endsWith('.tsx') ||
    lower.endsWith('.js') ||
    lower.endsWith('.jsx')
  ) {
    copy = 'no source map matched this position for this release'
  } else {
    copy = 'source not available for this frame'
  }
  return (
    <div className="bg-bg-tertiary/10 text-fg-muted px-3 py-1 font-mono text-[10px] tracking-[0.05em]">
      {copy}
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
    queryKey: qk.event.frameSource(projectId, eventId, frame, contextLines),
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
    return <ModuleEmpty eyebrow="Breadcrumbs">No breadcrumbs on this event.</ModuleEmpty>
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
  if (keys.length === 0) return <ModuleEmpty eyebrow="Tags">No tags on this event.</ModuleEmpty>
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
    queryKey: qk.issue.activity(projectId, issueId),
  })

  const createM = useMutation({
    mutationFn: (body: string) => adminApi.createIssueComment(projectId, issueId, body),
    onSuccess: () => {
      setDraft('')
      void qc.invalidateQueries({ queryKey: qk.issue.activity(projectId, issueId) })
    },
  })
  const deleteM = useMutation({
    mutationFn: (commentId: string) => adminApi.deleteIssueComment(projectId, issueId, commentId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.issue.activity(projectId, issueId) }),
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

function StateEntry({ entry }: { entry: Exclude<ActivityEntry, { kind: 'comment' }> }) {
  const meta = describeStateEntry(entry)
  return (
    <div className="t-md flex items-baseline gap-3 px-3 py-2">
      <span className={`t-sm font-medium tracking-wide uppercase ${meta.cls}`}>{meta.label}</span>
      <span className="text-fg-muted t-sm flex-1 truncate">{meta.detail}</span>
      <span className="text-fg-muted t-sm font-mono tabular-nums">{formatRelative(entry.at)}</span>
      {(entry.kind === 'resolved' || entry.kind === 'regressed') && entry.release && (
        <span className="text-fg-muted t-md font-mono">in {entry.release}</span>
      )}
    </div>
  )
}

// v1.2 W10: per-kind chrome for the timeline. Keeps StateEntry's JSX
// flat (label · detail · ago) so the feed reads as one event-per-row.
function describeStateEntry(entry: Exclude<ActivityEntry, { kind: 'comment' }>): {
  cls: string
  detail: string
  label: string
} {
  switch (entry.kind) {
    case 'resolved':
      return { cls: 'text-success', detail: '', label: 'Resolved' }
    case 'regressed':
      return { cls: 'text-danger', detail: '', label: 'Regressed' }
    case 'statusChanged': {
      const via = entry.bulk ? ' (bulk)' : ''
      const from = entry.from ? `${entry.from} → ` : ''
      return {
        cls: 'text-fg-muted',
        detail: `${from}${entry.to}${via}`,
        label: 'Status',
      }
    }
    case 'assigneeChanged': {
      const via = entry.bulk ? ' (bulk)' : ''
      if (!entry.to) {
        return { cls: 'text-fg-muted', detail: `unassigned${via}`, label: 'Assignee' }
      }
      return { cls: 'text-fg-muted', detail: `→ ${entry.to.slice(0, 8)}${via}`, label: 'Assignee' }
    }
    case 'merged':
      return {
        cls: 'text-fg-muted',
        detail: `${entry.eventsMoved ?? '?'} events from ${(entry.fromIssueId ?? '').slice(0, 8)}`,
        label: 'Merged',
      }
    case 'priorityChanged':
      return {
        cls: 'text-fg-muted',
        detail: `${entry.from ?? '?'} → ${entry.to}`,
        label: 'Priority',
      }
    case 'labelsChanged': {
      const parts: string[] = []
      if (entry.added.length > 0) parts.push(`+${entry.added.join(', ')}`)
      if (entry.removed.length > 0) parts.push(`-${entry.removed.join(', ')}`)
      return { cls: 'text-fg-muted', detail: parts.join(' · ') || 'no changes', label: 'Labels' }
    }
  }
}

// v0.9.6 #15 — compact "at a glance" strip below the culprit section.
// Single dense row pulling key dims from the selected event payload
// + a row of attachment availability badges so the operator knows
// what kinds of attached evidence exist before clicking through tabs.
function EventGlanceStrip({ event, projectId }: { event: EventRow; projectId: string }) {
  const p = event.payload
  const attachmentsQ = useQuery({
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.listEventAttachments(projectId, event.id),
    queryKey: qk.event.attachments(projectId, event.id),
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
    <div className="border-y border-[color:var(--rule)] py-3">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        {dims.map((d) => (
          <span className="flex items-baseline gap-1.5" key={d.label}>
            <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              {d.label}
            </span>
            <span className="font-mono text-[12px] text-[color:var(--ink)]">{d.value}</span>
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
          attached
        </span>
        <Badge label="screenshot" present={has('screenshot')} />
        <Badge label="replay" present={has('replay')} />
        <Badge label="state" present={has('stateSnapshot')} />
        <Badge label="trail" present={has('sessionTrail')} />
        <Badge label="viewTree" present={has('viewTree')} />
        {attachmentsQ.isLoading && (
          <span className="font-mono text-[11px] text-[color:var(--ink-muted)]">…</span>
        )}
      </div>
    </div>
  )
}

function Badge({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`inline-flex items-baseline gap-1 font-mono text-[11px] tabular-nums ${
        present ? 'text-[color:var(--accent)]' : 'text-[color:var(--ink-muted)]'
      }`}
    >
      <span aria-hidden>{present ? '●' : '○'}</span>
      <span>{label}</span>
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
    queryKey: qk.issue.culprits(projectId, issueId),
  })
  const attachM = useMutation({
    mutationFn: (sha: string) => adminApi.attachCulprit(projectId, issueId, sha),
    onSuccess: () => {
      setDraft('')
      setOpen(false)
      void qc.invalidateQueries({ queryKey: qk.issue.culprits(projectId, issueId) })
    },
  })
  const detachM = useMutation({
    mutationFn: (id: string) => adminApi.detachCulprit(projectId, issueId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.issue.culprits(projectId, issueId) }),
  })
  const autoM = useMutation({
    mutationFn: () => adminApi.autoDetectCulprit(projectId, issueId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.issue.culprits(projectId, issueId) }),
  })
  const revertM = useMutation({
    mutationFn: (culpritId: string) => adminApi.generateRevertPr(projectId, issueId, culpritId),
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
            <span className="text-danger ml-3 font-mono text-[10px]">
              auto-detect failed: {String((autoM.error as Error)?.message ?? 'unknown')}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3">
          <button
            className="text-accent hover:text-fg t-sm font-mono disabled:opacity-50"
            disabled={autoM.isPending || !sourceRepoUrl}
            onClick={() => autoM.mutate()}
            title={
              !sourceRepoUrl
                ? 'Culprit auto-detect needs source_repo_url (separate from frame source view)'
                : 'auto-detect via GitHub'
            }
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
              Commit attach needs <code className="font-mono">source_repo_url</code> in project
              settings (this is the GitHub deep-link path — frame source view works without it).
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
            <span className="text-fg-muted font-mono text-[11px]">{c.commitSha.slice(0, 7)}</span>
            <span className="text-fg t-sm flex-1 truncate">
              {c.message ? c.message.split('\n')[0] : '(metadata fetch failed)'}
            </span>
            {c.author && <span className="text-fg-muted t-sm font-mono">@{c.author}</span>}
            {c.source === 'auto' && (
              <span className="text-accent font-mono text-[9px] tracking-wider uppercase">
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
        <div className="border-border text-danger border-t px-3 py-1.5 font-mono text-[10px]">
          {autoM.isError && (
            <>
              auto: {String((autoM.error as Error)?.message ?? 'unknown')}
              <br />
            </>
          )}
          {revertM.isError && (
            <>revert PR: {String((revertM.error as Error)?.message ?? 'unknown')}</>
          )}
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
    queryKey: qk.issue.userReports(projectId, issueId),
  })
  const reports = reportsQ.data ?? []
  if (reportsQ.isLoading) {
    return <div className="text-fg-muted t-md px-3 py-3">Loading…</div>
  }
  if (reports.length === 0) {
    return (
      <ModuleEmpty eyebrow="No user reports for this issue">
        {
          'Host app calls `sentori.sendUserFeedback({ eventId, title, body, email? })` — reports with a matching eventId land here automatically.'
        }
      </ModuleEmpty>
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
        {report.eventId && <span className="font-mono">event {report.eventId.slice(0, 8)}</span>}
      </div>
    </li>
  )
}

// ── small helpers ──────────────────────────────────────────────────────

function Pane({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">{title}</span>
      </header>
      <div>{children}</div>
    </section>
  )
}

/**
 * Per-event "Error body + debug peek" pane that sits above the
 * attachment gallery + stack trace on the Stack tab. Whereas the issue
 * h1 shows a SAMPLED message (representative of the issue across all
 * events), this pane shows the message + cause chain + last few
 * breadcrumbs for **this specific event** the user is scrubbing —
 * so `[` / `]` between events visibly changes content here.
 */
function ErrorBodyPane({ event }: { event: EventRow }) {
  const err = event.payload.error
  if (!err) return null
  const causeChain: { message?: string; type: string }[] = []
  let c = err.cause
  while (c) {
    causeChain.push({ message: c.message, type: c.type })
    c = c.cause
  }
  const lastCrumbs = (event.payload.breadcrumbs ?? []).slice(-3).reverse()
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">Error</span>
        <span className="sec-head-sub">event {event.id.slice(0, 8)}</span>
      </header>
      <div className="space-y-3">
        <div className="grid grid-cols-[120px_1fr] items-baseline gap-x-4">
          <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
            type
          </span>
          <span className="font-mono text-[13px] break-all text-[color:var(--danger)]">
            {err.type}
          </span>
        </div>
        {err.message && (
          <div className="grid grid-cols-[120px_1fr] items-baseline gap-x-4">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
              message
            </span>
            <pre className="font-sans text-[13px] leading-snug break-words whitespace-pre-wrap text-[color:var(--ink)]">
              {err.message}
            </pre>
          </div>
        )}
        {causeChain.length > 0 && (
          <div className="grid grid-cols-[120px_1fr] items-baseline gap-x-4">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
              caused by
            </span>
            <ul className="space-y-1">
              {causeChain.map((c, i) => (
                <li className="font-mono text-[12px] break-words" key={i}>
                  <span className="text-[color:var(--danger)]">{c.type}</span>
                  {c.message && (
                    <>
                      <span className="text-[color:var(--ink-muted)]">: </span>
                      <span className="text-[color:var(--ink-soft)]">{c.message}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {lastCrumbs.length > 0 && (
          <div className="grid grid-cols-[120px_1fr] items-baseline gap-x-4">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
              breadcrumbs
            </span>
            <ul className="space-y-1.5">
              {lastCrumbs.map((b, i) => (
                <li className="text-[12px] leading-snug" key={i}>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] tabular-nums">
                    {timeOfDay(b.timestamp)}
                  </span>
                  <span
                    className={`ml-2 font-mono text-[9px] tracking-[0.18em] uppercase ${CRUMB_COLOR[b.type]}`}
                  >
                    {b.type}
                  </span>
                  <div className="mt-0.5 font-mono text-[11px] break-words text-[color:var(--ink)]">
                    {stringifyData(b.data)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Right-rail context for the screenshot debug center. The fullscreen
 * viewer is "the operator is staring at the crash UI" — that view is
 * useless without the same event dims the inline page shows. This is
 * the canonical slot; keep it in sync when the issue-detail glance
 * strip grows new fields.
 */
function DebugCenterEventContext({ event }: { event: EventRow }) {
  const p = event.payload
  const errMsg = p.error?.message
  const crumbs = (p.breadcrumbs ?? []).slice(-3).reverse()
  const flagEntries = Object.entries(p.flags ?? {})
  const release = p.release
  const bundle = p.bundle
    ? p.bundle.source
      ? `${p.bundle.id} (${p.bundle.source})`
      : p.bundle.id
    : null
  const osLine =
    p.device?.os && p.device?.osVersion
      ? `${p.device.os} ${p.device.osVersion}`
      : (p.device?.os ?? null)
  const geoLine = p.geo
    ? [p.geo.country, p.geo.region, p.geo.city].filter(Boolean).join(' · ')
    : null

  return (
    <div className="space-y-5">
      <CtxBlock title="Error">
        <Row label="type">
          <span className="font-mono text-[12px] break-all text-[color:var(--danger)]">
            {p.error?.type ?? '—'}
          </span>
        </Row>
        {errMsg && (
          <Row label="message">
            <span className="font-sans text-[12px] leading-snug break-words">
              {errMsg.split('\n')[0]}
            </span>
          </Row>
        )}
      </CtxBlock>

      <CtxBlock title="Release">
        <Row label="release">
          <span className="font-mono text-[12px] break-all">{release}</span>
        </Row>
        {bundle && (
          <Row label="bundle">
            <span className="font-mono text-[12px] break-all">{bundle}</span>
          </Row>
        )}
        <Row label="env">
          <span className="font-mono text-[12px]">{p.environment}</span>
        </Row>
      </CtxBlock>

      <CtxBlock title="Device">
        <Row label="platform">
          <span className="font-mono text-[12px]">{p.platform}</span>
        </Row>
        {osLine && (
          <Row label="os">
            <span className="font-mono text-[12px]">{osLine}</span>
          </Row>
        )}
        {p.device?.model && (
          <Row label="model">
            <span className="font-mono text-[12px]">{p.device.model}</span>
          </Row>
        )}
        {p.device?.locale && (
          <Row label="locale">
            <span className="font-mono text-[12px]">{p.device.locale}</span>
          </Row>
        )}
        {p.device?.networkType && (
          <Row label="net">
            <span className="font-mono text-[12px]">{p.device.networkType}</span>
          </Row>
        )}
        {geoLine && (
          <Row label="geo">
            <span className="font-sans text-[12px]">{geoLine}</span>
          </Row>
        )}
      </CtxBlock>

      {(p.user?.id || flagEntries.length > 0) && (
        <CtxBlock title="User & flags">
          {p.user?.id && (
            <Row label="user.id">
              <span className="font-mono text-[12px] break-all">{p.user.id}</span>
            </Row>
          )}
          {flagEntries.map(([k, v]) => (
            <Row key={k} label={`flag:${k}`}>
              <span className="font-mono text-[12px]">{String(v)}</span>
            </Row>
          ))}
        </CtxBlock>
      )}

      {crumbs.length > 0 && (
        <CtxBlock title="Last breadcrumbs">
          <ul className="space-y-1.5">
            {crumbs.map((b, i) => (
              <li key={i} className="text-[11px] leading-snug">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] tabular-nums">
                  {timeOfDay(b.timestamp)}
                </span>
                <span
                  className={`ml-2 font-mono text-[9px] tracking-[0.18em] uppercase ${CRUMB_COLOR[b.type]}`}
                >
                  {b.type}
                </span>
                <div className="mt-0.5 font-mono text-[11px] break-words text-[color:var(--ink)]">
                  {stringifyData(b.data)}
                </div>
              </li>
            ))}
          </ul>
        </CtxBlock>
      )}
    </div>
  )
}

/**
 * Mini-section header inside the debug-center right rail. Matches the
 * "Debug context" head style above the slot so the eye flows naturally.
 */
function CtxBlock({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
        {title}
      </div>
      <div>{children}</div>
    </div>
  )
}

/** Editorial label / value row — used by the screenshot debug center
 *  context slot (and re-usable when we surface event metadata
 *  inline). 80px label gutter so values line up across a stack. */
function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-3 py-1 text-[12px]">
      <div className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </div>
      <div className="text-[color:var(--ink)]">{children}</div>
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

/**
 * v2.1 — re-fingerprint admin tool button + preview/apply modal.
 *
 * Renders a small admin-style trigger ("⚙ re-group by current rules")
 * below the standard issue actions. Click → dry-run via
 * `refingerprintIssue({apply: false})` → modal lists the new
 * fingerprint groups + counts + sample messages. Apply button calls
 * again with `{apply: true, confirm: 'yes'}` (the server requires the
 * literal "yes" — typo-shield).
 *
 * Hidden when the issue has < 2 fingerprint groups (nothing to split).
 *
 * Server-side enforces role gate (owner / admin via membership), so
 * a non-admin click results in a 403 from the dry-run — we surface
 * that as a red banner inside the modal.
 */
function RefingerprintAdmin({
  issueId,
  projectId,
  title,
}: {
  issueId: string
  projectId: string
  title: string
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const dryRunM = useMutation({
    mutationFn: () => adminApi.refingerprintIssue(projectId, issueId, { apply: false }),
  })
  const applyM = useMutation({
    mutationFn: () =>
      adminApi.refingerprintIssue(projectId, issueId, { apply: true, confirm: 'yes' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.issue.detail(projectId, issueId) })
      void qc.invalidateQueries({ queryKey: qk.issue.list(projectId) })
    },
  })

  const preview: null | RefingerprintResponse = applyM.data ?? dryRunM.data ?? null
  const nonCurrentGroups = preview?.groups.filter((g) => !g.staysInCurrent) ?? []
  const nothingToSplit = !!preview && nonCurrentGroups.length === 0

  const onOpen = () => {
    setOpen(true)
    if (!preview) dryRunM.mutate()
  }
  const onClose = () => {
    setOpen(false)
    dryRunM.reset()
    applyM.reset()
  }

  return (
    <>
      <div className="mt-3 flex items-center gap-2 border-t border-[color:var(--rule-soft)] pt-3">
        <span className="font-mono text-[9px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
          admin
        </span>
        <button
          className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
          onClick={onOpen}
          type="button"
        >
          ⚙ re-group by current rules
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(0,0,0,0.5)] p-4">
          <div className="w-full max-w-[640px] border border-[color:var(--rule)] bg-[color:var(--paper)] p-5 shadow-xl">
            <header className="mb-4 flex items-baseline justify-between border-b border-[color:var(--rule)] pb-3">
              <div>
                <h2 className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                  re-group by current rules
                </h2>
                <p className="mt-1 font-mono text-[11px] text-[color:var(--ink-soft)]">{title}</p>
              </div>
              <button
                className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--ink)]"
                onClick={onClose}
                type="button"
              >
                close
              </button>
            </header>

            {dryRunM.isPending && (
              <p className="py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
                analysing…
              </p>
            )}

            {dryRunM.error && (
              <p className="py-3 text-center font-mono text-[11px] text-[color:var(--danger)]">
                {errOf(dryRunM.error)} — re-fingerprint is admin-only.
              </p>
            )}

            {applyM.error && (
              <p className="py-3 text-center font-mono text-[11px] text-[color:var(--danger)]">
                Apply failed: {errOf(applyM.error)}
              </p>
            )}

            {applyM.data && applyM.data.applied && (
              <p className="mb-3 border border-[color:var(--success)] bg-[color:var(--paper-2)] p-3 font-mono text-[11px] text-[color:var(--success)]">
                ✓ applied. {nonCurrentGroups.length} group
                {nonCurrentGroups.length === 1 ? '' : 's'} migrated.
              </p>
            )}

            {preview && (
              <div className="space-y-3">
                <p className="font-mono text-[11px] text-[color:var(--ink-soft)]">
                  {preview.totalEvents.toLocaleString()} events. Current fingerprint:{' '}
                  <span className="text-[color:var(--ink)]">{preview.currentFp.slice(0, 8)}</span>.
                </p>

                {nothingToSplit ? (
                  <p className="border border-[color:var(--rule)] p-3 font-mono text-[11px] text-[color:var(--ink-soft)]">
                    All events already match the current fingerprint — nothing to split.
                  </p>
                ) : (
                  <>
                    <p className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                      {nonCurrentGroups.length} group
                      {nonCurrentGroups.length === 1 ? '' : 's'} would migrate:
                    </p>
                    <ul className="divide-y divide-[color:var(--rule-soft)] border border-[color:var(--rule)]">
                      {preview.groups.map((g) => (
                        <li className="flex items-baseline gap-3 px-3 py-2" key={g.fp}>
                          <span className="basis-[6ch] font-mono text-[10px] text-[color:var(--ink-muted)]">
                            {g.fp.slice(0, 6)}
                          </span>
                          <span
                            className={`basis-[6ch] font-mono text-[11px] tabular-nums ${
                              g.staysInCurrent
                                ? 'text-[color:var(--success)]'
                                : 'text-[color:var(--accent)]'
                            }`}
                          >
                            {g.count.toLocaleString()}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[12px] text-[color:var(--ink)]">
                            {g.sample}
                          </span>
                          <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                            {g.staysInCurrent ? 'stays' : g.targetIssueId ? 'merges' : 'new'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-[color:var(--rule)] pt-3">
              <button
                className="inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--ink)]"
                onClick={onClose}
                type="button"
              >
                cancel
              </button>
              <button
                className="inline-flex h-7 items-center bg-[color:var(--accent)] px-4 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  !preview ||
                  nothingToSplit ||
                  applyM.isPending ||
                  (!!applyM.data && applyM.data.applied)
                }
                onClick={() => applyM.mutate()}
                type="button"
              >
                {applyM.isPending
                  ? 'applying…'
                  : applyM.data?.applied
                    ? 'applied'
                    : 'apply migration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function errOf(e: unknown): null | string {
  if (!e) return null
  const body = (e as { body?: { error?: string } } | undefined)?.body
  if (body?.error) return body.error
  if (e instanceof Error) return e.message
  return 'request failed'
}

/**
 * v2.2 — cross-release issue lineage panel.
 *
 * Post-2.1 fingerprint policy isolates each release into its own
 * issue row. That gives clean per-release reading but loses the
 * Sentry-style "this resolved bug came back" flip. This panel
 * surfaces the same intelligence without merging the rows: list
 * other issues with the same `error_type` in DIFFERENT releases.
 * Operator scans + decides if the match is real (status badge +
 * message preview help).
 *
 * Quiet panel — hidden when no candidates. Doesn't compete with
 * the existing LinkedIssuesPanel (that one is integration-side
 * links like Linear / Jira).
 */
function RelatedAcrossReleasesPanel({
  currentOrgSlug,
  issueId,
  projectId,
}: {
  currentOrgSlug: string
  issueId: string
  projectId: string
}) {
  const q = useQuery({
    enabled: !!projectId && !!issueId,
    queryFn: () => adminApi.relatedAcrossReleases(projectId, issueId),
    queryKey: ['related-across-releases', projectId, issueId],
  })

  const related = q.data?.related ?? []
  if (q.isLoading || related.length === 0) return null

  return (
    <section className="mt-6 border-y border-[color:var(--rule)] py-3">
      <header className="mb-2 flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
          related across releases
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase">
          same error_type · different release
        </span>
      </header>
      <ul className="divide-y divide-[color:var(--rule-soft)]">
        {related.map((r) => (
          <RelatedRow currentOrgSlug={currentOrgSlug} key={r.id} row={r} />
        ))}
      </ul>
    </section>
  )
}

function RelatedRow({
  currentOrgSlug,
  row,
}: {
  currentOrgSlug: string
  row: CrossReleaseRelatedIssue
}) {
  return (
    <li className="flex items-baseline gap-3 py-2">
      <Link
        className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--ink)] hover:text-[color:var(--accent)]"
        to={`/main/org/${currentOrgSlug}/issues/${row.id}`}
      >
        {row.messageSample || '(no message)'}
      </Link>
      <span className="font-mono text-[10px] tracking-[0.08em] text-[color:var(--ink-muted)]">
        {row.lastRelease || '—'}
      </span>
      <span
        className={`font-mono text-[10px] tracking-[0.18em] uppercase ${
          row.status === 'resolved'
            ? 'text-[color:var(--success)]'
            : row.status === 'active' || row.status === 'regressed'
              ? 'text-[color:var(--warning)]'
              : 'text-[color:var(--ink-muted)]'
        }`}
      >
        {row.status}
      </span>
      <span className="font-mono text-[10px] text-[color:var(--ink-muted)] tabular-nums">
        {row.eventCount.toLocaleString()}
      </span>
    </li>
  )
}
