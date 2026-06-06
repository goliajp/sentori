import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import {
  orgsApi,
  type UsersDetailResp,
  type UsersDetailTimelineBucket,
  type UsersDetailTopIssue,
} from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { InlineEmpty, Hint } from '@/components/Hint'
import { Stat } from '@/components/Stat'
import { qk } from '@/api/query-keys'
import { formatRelative } from '@/lib/format'
import { PageHeader } from '@/layout/page-header'
import { useUrlParam } from '@/lib/url-state'

import { VALID_WINDOW_DAYS } from './window'
import { WindowSwitcher } from './window-switcher'

/**
 * v2.4 — Single-fingerprint drill-in.
 *
 * Route: /main/org/:slug/users/:fingerprintHex
 *
 * Operator lands here from the most-affected list (or a deep link).
 * Page shows: KPI band, hour-bucketed event/error timeline,
 * top issues this fingerprint touched, and per-project hits.
 *
 * Privacy: the path param IS the salted stored fingerprint hex.
 * We never display or solicit raw identity here.
 */

const DEFAULT_DAYS = 7

export function UserDetailView() {
  const { currentOrg } = useOrg()
  const { fingerprintHex = '' } = useParams<{ fingerprintHex: string }>()
  const looksValid = /^[a-f0-9]{64}$/.test(fingerprintHex)
  const [daysParam, setDaysParam] = useUrlParam<string>('window', String(DEFAULT_DAYS))
  const days = (() => {
    const parsed = Number(daysParam)
    return Number.isFinite(parsed) && VALID_WINDOW_DAYS.has(parsed) ? parsed : DEFAULT_DAYS
  })()
  const onWindowChange = (next: number) => setDaysParam(String(next))

  const { data, error, isLoading } = useQuery<UsersDetailResp, Error>({
    enabled: looksValid,
    queryFn: () => orgsApi.usersDetail(currentOrg.slug, fingerprintHex, { days }),
    queryKey: qk.users.detail(currentOrg.slug, fingerprintHex, days),
    staleTime: 30_000,
  })

  if (!looksValid) {
    return (
      <div className="">
        <PageHeader subtitle="malformed fingerprint" title="User detail" />
        <Hint danger>
          Fingerprint segment must be 64-char lowercase hex. Got
          <span className="ml-1 font-mono">{fingerprintHex || '(empty)'}</span>.
        </Hint>
        <p className="text-fg-muted mt-3 font-mono text-[11px]">
          <Link className="hover:text-fg-secondary" to={`/main/org/${currentOrg.slug}/users`}>
            ← back to Users
          </Link>
        </p>
      </div>
    )
  }
  if (isLoading && !data) {
    return (
      <div className="">
        <PageHeader subtitle={short(fingerprintHex)} title="User detail" />
        <Hint>Loading fingerprint detail…</Hint>
      </div>
    )
  }
  if (error) {
    return (
      <div className="">
        <PageHeader subtitle={short(fingerprintHex)} title="User detail" />
        <Hint danger>Failed to load fingerprint detail.</Hint>
      </div>
    )
  }
  if (!data) return null

  const everEmpty =
    data.totalEvents === 0 &&
    data.hits.length === 0 &&
    data.timeline.length === 0 &&
    data.topIssues.length === 0

  const totalErrors = data.timeline.reduce((acc, b) => acc + b.errorCount, 0)
  const distinctProjects = data.hits.length

  return (
    <div className="">
      <PageHeader subtitle={short(fingerprintHex)} title="User detail" />

      <div className="text-fg-muted mb-4 flex flex-wrap items-baseline gap-3 font-mono text-[11px]">
        <Link className="hover:text-fg-secondary" to={`/main/org/${currentOrg.slug}/users`}>
          ← back to Users
        </Link>
        <span>
          scope <span className="text-fg-secondary">{data.scopeId.slice(0, 8)}</span>
        </span>
        <FingerprintCopy hex={fingerprintHex} />
        <span className="ml-auto">
          <WindowSwitcher onChange={onWindowChange} value={days} />
        </span>
      </div>

      {everEmpty ? (
        <InlineEmpty>
          No events match this fingerprint in your org over the last {data.windowDays} day
          {data.windowDays === 1 ? '' : 's'}.
        </InlineEmpty>
      ) : (
        <div className="space-y-8">
          <section
            aria-label="kpi"
            className="border-border grid grid-cols-1 border-y sm:grid-cols-3"
          >
            <Stat
              label={`events · ${data.windowDays}d`}
              sub="all kinds"
              value={data.totalEvents.toLocaleString()}
            />
            <Stat
              highlight={totalErrors > 0}
              label="errors"
              sub="error / anr / nearCrash"
              value={totalErrors.toLocaleString()}
            />
            <Stat label="projects" sub="distinct hits" value={distinctProjects.toLocaleString()} />
          </section>

          <Timeline buckets={data.timeline} />

          <IssuesSection issues={data.topIssues} orgSlug={currentOrg.slug} />

          <ProjectsSection
            fingerprintHex={fingerprintHex}
            hits={data.hits}
            orgSlug={currentOrg.slug}
          />
        </div>
      )}
    </div>
  )
}

function Timeline({ buckets }: { buckets: UsersDetailTimelineBucket[] }) {
  if (buckets.length === 0) {
    return (
      <section>
        <Header title="Timeline" />
        <p className="text-fg-muted py-2 font-mono text-[11px]">no events in this window.</p>
      </section>
    )
  }
  const maxCount = Math.max(...buckets.map((b) => b.eventCount), 1)
  // Bars use flex-1 so the row always exactly fills its container —
  // 24 hourly buckets over 7d or 720 over 30d both lay out cleanly
  // without horizontal overflow. (Pre-polish, fixed-6px-bars on 30d
  // pushed the row to ~5760px and broke the page layout.)
  const firstTs = buckets[0]?.hourBucket
  const lastTs = buckets[buckets.length - 1]?.hourBucket
  return (
    <section>
      <Header title="Timeline" />
      <div className="border-border flex h-16 items-end gap-[1px] border-b py-3">
        {buckets.map((b) => {
          const h = (b.eventCount / maxCount) * 56
          const errPct = b.eventCount === 0 ? 0 : b.errorCount / b.eventCount
          return (
            <div
              key={b.hourBucket}
              className="relative h-full min-w-0 flex-1"
              title={`${new Date(b.hourBucket).toLocaleString()} — ${b.eventCount} events (${b.errorCount} error)`}
            >
              <div
                className="bg-fg-secondary absolute right-0 bottom-0 left-0"
                style={{
                  height: `${h}px`,
                  opacity: 0.35 + errPct * 0.55,
                }}
              />
              {b.errorCount > 0 && (
                <div
                  className="bg-danger absolute right-0 bottom-0 left-0"
                  style={{
                    height: `${h * errPct}px`,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
      <div className="text-fg-muted mt-2 flex items-baseline justify-between font-mono text-[10px] tracking-[0.18em] uppercase">
        <span>{firstTs ? new Date(firstTs).toLocaleString() : ''}</span>
        <span>hourly · grey events · red errors</span>
        <span>{lastTs ? new Date(lastTs).toLocaleString() : ''}</span>
      </div>
    </section>
  )
}

/**
 * Copy-to-clipboard chip for the full 64-char fingerprint hex. Lets
 * an operator paste the value into a ticket, chat, or another tab
 * without losing the trailing 52 chars to the PageHeader's truncation.
 */
function FingerprintCopy({ hex }: { hex: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(hex)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // clipboard may be unavailable (insecure context, denied perms);
      // swallow — the URL still carries the full hex if needed.
    }
  }
  return (
    <button
      className="text-fg-muted hover:text-fg-secondary font-mono text-[11px] underline decoration-dotted underline-offset-4"
      onClick={onCopy}
      title={hex}
      type="button"
    >
      {copied ? 'copied ✓' : 'copy full hex'}
    </button>
  )
}

function IssuesSection({ issues, orgSlug }: { issues: UsersDetailTopIssue[]; orgSlug: string }) {
  return (
    <section>
      <Header title="Top issues touched" />
      {issues.length === 0 ? (
        <p className="text-fg-muted py-2 font-mono text-[11px]">
          this fingerprint has no issue-classified events.
        </p>
      ) : (
        <table className="bench">
          <thead>
            <tr>
              <th>issue</th>
              <th className="num">events</th>
              <th className="num">last seen</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.issueId}>
                <td className="lead">
                  <Link
                    className="text-fg hover:text-accent"
                    to={`/main/org/${orgSlug}/projects/${i.projectId}/issues/${i.issueId}`}
                  >
                    {i.title}
                  </Link>
                </td>
                <td className="num tabular-nums">{i.eventCount.toLocaleString()}</td>
                <td className="num">{formatRelative(i.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function ProjectsSection({
  fingerprintHex,
  hits,
  orgSlug,
}: {
  fingerprintHex: string
  hits: UsersDetailResp['hits']
  orgSlug: string
}) {
  return (
    <section>
      <Header title="Per-project hits" />
      {hits.length === 0 ? (
        <p className="text-fg-muted py-2 font-mono text-[11px]">
          no project ever ingested an event for this fingerprint.
        </p>
      ) : (
        <table className="bench">
          <thead>
            <tr>
              <th>project</th>
              <th className="num">events</th>
              <th className="num">issues</th>
              <th className="num">first seen</th>
              <th className="num">last seen</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.projectId}>
                <td className="lead">
                  <Link
                    className="text-fg hover:text-accent"
                    to={`/main/org/${orgSlug}/issues?user=${encodeURIComponent(fingerprintHex)}`}
                  >
                    <span className="font-mono text-[11px]">{h.projectId}</span>
                  </Link>
                </td>
                <td className="num tabular-nums">{h.eventCount.toLocaleString()}</td>
                <td className="num tabular-nums">{h.issueCount.toLocaleString()}</td>
                <td className="num">{formatRelative(h.firstSeen)}</td>
                <td className="num">{formatRelative(h.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Header({ title }: { title: string }) {
  return (
    <header className="border-border mb-3 border-b pb-2">
      <span className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">{title}</span>
    </header>
  )
}

function short(hex: string) {
  return hex.length >= 12 ? `${hex.slice(0, 12)}…` : hex
}
