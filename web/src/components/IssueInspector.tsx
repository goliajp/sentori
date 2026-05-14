import { useState } from 'react'

import type { IssueRow } from '@/api/client'
import { useToast } from '@/components/ui'

/**
 * Phase 50 sub-D1 — issue inspector right rail.
 *
 * Linear-issue style 280px column rendering issue metadata at a
 * glance: status, assignee, first/last seen, event count,
 * fingerprint (with copy), releases, tags. Stays out of the main
 * stack-content scroll area so triage flows like
 * "skim → read stack → copy fingerprint → assign" are one-screen.
 *
 * Read-only for now — assignee / resolve / silence stay in the
 * header IssueActions component. A future pass could move them
 * here for full Linear parity, but that's a behavioural change,
 * not a visual one.
 */
export function IssueInspector({ issue, releases }: { issue: IssueRow; releases?: string[] }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(issue.fingerprint)
      setCopied(true)
      toast.success('Fingerprint copied')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Fingerprint:', issue.fingerprint)
    }
  }

  return (
    <aside
      aria-label="Issue metadata"
      className="border-border bg-bg-secondary/40 hidden w-72 shrink-0 overflow-y-auto border-l p-4 text-[12px] lg:block"
    >
      <Row label="Status">
        <StatusPill status={issue.status} />
      </Row>
      {issue.assigneeEmail && <Row label="Assignee">@{issue.assigneeEmail.split('@')[0]}</Row>}
      <Row label="First seen">
        <time className="text-fg" dateTime={issue.firstSeen} title={issue.firstSeen}>
          {formatRel(issue.firstSeen)}
        </time>
      </Row>
      <Row label="Last seen">
        <time className="text-fg" dateTime={issue.lastSeen} title={issue.lastSeen}>
          {formatRel(issue.lastSeen)}
        </time>
      </Row>
      <Row label="Events">
        <span className="text-fg font-mono tabular-nums">{issue.eventCount.toLocaleString()}</span>
      </Row>
      {issue.lastEnvironment && (
        <Row label="Environment">
          <span className="text-fg font-mono">{issue.lastEnvironment}</span>
        </Row>
      )}
      {issue.lastRelease && (
        <Row label="Last release">
          <span className="text-fg font-mono break-all">{issue.lastRelease}</span>
        </Row>
      )}
      {issue.resolvedInRelease && (
        <Row label="Resolved in">
          <span className="text-fg font-mono break-all">{issue.resolvedInRelease}</span>
        </Row>
      )}
      {issue.regressedAt && issue.regressedInRelease && (
        <Row label="Regressed in">
          <span className="text-fg font-mono break-all">{issue.regressedInRelease}</span>
        </Row>
      )}
      <Row label="Fingerprint">
        <button
          aria-label="Copy fingerprint"
          className="text-fg hover:text-accent font-mono text-[11px] underline-offset-2 hover:underline"
          onClick={copyFingerprint}
          title={`Copy: ${issue.fingerprint}`}
          type="button"
        >
          {copied ? '✓ Copied' : `${issue.fingerprint.slice(0, 12)}…`}
        </button>
      </Row>
      {releases && releases.length > 0 && (
        <Row label={`Releases (${releases.length})`}>
          <div className="flex flex-wrap gap-1">
            {releases.slice(0, 6).map((r) => (
              <span
                className="border-border bg-bg-tertiary rounded px-1.5 py-[1px] font-mono text-[10px]"
                key={r}
                title={r}
              >
                {r.length > 14 ? `${r.slice(0, 12)}…` : r}
              </span>
            ))}
            {releases.length > 6 && (
              <span className="text-fg-muted text-[10px]">+{releases.length - 6}</span>
            )}
          </div>
        </Row>
      )}
    </aside>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="border-border/60 flex items-start justify-between gap-3 border-b py-2 last:border-b-0">
      <span className="text-fg-muted shrink-0 text-[11px] tracking-wide uppercase">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  )
}

function StatusPill({ status }: { status: IssueRow['status'] }) {
  const map: Record<IssueRow['status'], { className: string; label: string }> = {
    active: {
      className:
        'bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)] border-[color:var(--color-warning-border)]',
      label: 'Active',
    },
    closed: { className: 'bg-bg-tertiary text-fg-muted border-border', label: 'Closed' },
    regressed: {
      className:
        'bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)] border-[color:var(--color-danger-border)]',
      label: 'Regressed',
    },
    resolved: {
      className:
        'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)] border-[color:var(--color-success-border)]',
      label: 'Resolved',
    },
    silenced: { className: 'bg-bg-tertiary text-fg-muted border-border', label: 'Silenced' },
  }
  const s = map[status]
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${s.className}`}
    >
      {s.label}
    </span>
  )
}

function formatRel(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}
