import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate, useParams } from 'react-router'

import {
  adminApi,
  type Breadcrumb,
  DEV_PROJECT_ID,
  type Frame,
  type SentoriError,
} from '@/api/client'

export function IssueDetailView() {
  const { issueId } = useParams<{ issueId: string }>()
  const navigate = useNavigate()
  const [symbolicated, setSymbolicated] = useState(true)

  const issueQuery = useQuery({
    enabled: !!issueId,
    queryFn: () => adminApi.issueDetail(DEV_PROJECT_ID, issueId!),
    queryKey: ['issue', DEV_PROJECT_ID, issueId],
  })

  const eventsQuery = useQuery({
    enabled: !!issueId,
    queryFn: () =>
      adminApi.listEvents(DEV_PROJECT_ID, issueId!, {
        limit: 100,
        symbolicated,
      }),
    queryKey: ['events', DEV_PROJECT_ID, issueId, symbolicated],
  })

  const releasesQuery = useQuery({
    enabled: !!issueId,
    queryFn: () => adminApi.listReleasesForIssue(DEV_PROJECT_ID, issueId!),
    queryKey: ['issue-releases', DEV_PROJECT_ID, issueId],
  })

  const events = eventsQuery.data ?? []
  const [selectedIdx, setSelectedIdx] = useState(0)
  const safeIdx = events.length > 0 ? Math.min(selectedIdx, events.length - 1) : 0
  const selectedEvent = events[safeIdx]
  const payload = selectedEvent?.payload

  useHotkeys('[', () => setSelectedIdx((i) => Math.max(0, i - 1)))
  useHotkeys(']', () => setSelectedIdx((i) => Math.min(events.length - 1, i + 1)))
  useHotkeys('escape', () => navigate('/issues'))

  if (!issueId) return null

  if (issueQuery.isLoading || eventsQuery.isLoading) {
    return <div className="text-fg-muted px-6 py-6 text-sm">Loading…</div>
  }
  if (issueQuery.error) {
    return <div className="px-6 py-6 text-sm text-red-400">Failed to load issue.</div>
  }

  const issue = issueQuery.data
  if (!issue) return null

  return (
    <div className="flex h-full">
      <aside className="border-border w-64 shrink-0 overflow-y-auto border-r">
        <div className="border-border flex h-12 items-center border-b px-4">
          <button
            className="text-fg-muted hover:text-fg text-sm"
            onClick={() => navigate('/issues')}
            type="button"
          >
            ← Back
          </button>
        </div>
        {events.length === 0 ? (
          <div className="text-fg-muted p-4 text-sm">No events.</div>
        ) : (
          events.map((e, idx) => (
            <button
              className={`border-border/40 block w-full border-b px-4 py-2 text-left text-[12px] ${
                idx === safeIdx ? 'bg-accent/10' : 'hover:bg-bg-tertiary'
              }`}
              key={e.id}
              onClick={() => setSelectedIdx(idx)}
              type="button"
            >
              <div className="text-fg truncate font-mono">{e.id.slice(0, 8)}</div>
              <div className="text-fg-muted text-[11px]">{relativeTime(e.receivedAt)}</div>
            </button>
          ))
        )}
      </aside>

      <section className="flex-1 overflow-y-auto">
        <div className="border-border flex h-12 items-center border-b px-6">
          <h2 className="text-fg text-base font-semibold">{issue.errorType}</h2>
          <span className="text-fg-muted ml-2 truncate text-sm">{issue.messageSample}</span>
          <span className="text-fg-muted ml-auto font-mono text-[12px] tabular-nums">
            {issue.eventCount} events · use [/] to step
          </span>
        </div>

        {selectedEvent && payload && (
          <div className="space-y-6 px-6 py-4">
            <Section
              title="Stack"
              right={
                <button
                  className={`rounded-md px-2 py-0.5 text-[11px] tracking-wider uppercase transition-colors ${
                    symbolicated
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
                  }`}
                  onClick={() => setSymbolicated((s) => !s)}
                  type="button"
                >
                  {symbolicated ? 'symbolicated' : 'raw'}
                </button>
              }
            >
              <StackList stack={payload.error.stack} />
              {payload.error.cause && <CauseChain error={payload.error.cause} />}
            </Section>

            {payload.breadcrumbs && payload.breadcrumbs.length > 0 && (
              <Section title="Breadcrumbs">
                <BreadcrumbsList breadcrumbs={payload.breadcrumbs} />
              </Section>
            )}

            {payload.tags && Object.keys(payload.tags).length > 0 && (
              <Section title="Tags">
                <KeyValueGrid data={payload.tags} />
              </Section>
            )}

            {releasesQuery.data && releasesQuery.data.length > 0 && (
              <Section title="Releases">
                <div className="flex flex-wrap gap-2">
                  {releasesQuery.data.map((r) => (
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
        )}
      </section>
    </div>
  )
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

function StackList({ stack }: { stack: Frame[] }) {
  if (stack.length === 0) {
    return <p className="text-fg-muted text-sm">No frames.</p>
  }
  return (
    <div className="border-border overflow-hidden rounded-md border">
      {stack.map((frame, i) => (
        <div
          className={`border-border/40 flex items-baseline gap-3 border-b px-3 py-1.5 text-[12px] last:border-b-0 ${
            frame.inApp ? 'bg-bg' : 'bg-bg-tertiary/40 text-fg-muted'
          }`}
          key={i}
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
        </div>
      ))}
    </div>
  )
}

function CauseChain({ error }: { error: SentoriError }) {
  return (
    <div className="border-border/40 mt-3 border-l-2 pl-3">
      <p className="text-fg text-[12px]">
        <span className="text-fg-muted">caused by</span> {error.type}: {error.message}
      </p>
      <div className="mt-2">
        <StackList stack={error.stack} />
      </div>
      {error.cause && <CauseChain error={error.cause} />}
    </div>
  )
}

function BreadcrumbsList({ breadcrumbs }: { breadcrumbs: Breadcrumb[] }) {
  return (
    <div className="border-border overflow-hidden rounded-md border">
      {breadcrumbs.map((b, i) => (
        <div
          className="border-border/40 flex items-baseline gap-3 border-b px-3 py-1.5 text-[12px] last:border-b-0"
          key={i}
        >
          <span className="text-fg-muted w-16 font-mono text-[11px] tabular-nums">
            {b.timestamp.slice(11, 19)}
          </span>
          <span className="text-accent w-12 text-[11px] uppercase">{b.type}</span>
          <span className="text-fg-muted flex-1 truncate font-mono">{JSON.stringify(b.data)}</span>
        </div>
      ))}
    </div>
  )
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
