import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'

import { adminApi, type IssueStatus } from '@/api/client'

type WritableStatus = 'active' | 'closed' | 'resolved' | 'silenced'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'

/**
 * Issue detail — full v2 layout: header + actions + two-column main
 * (frame list + metadata sidebar).
 */
export function IssueDetailView() {
  const { issueId } = useParams<{ issueId: string }>()
  const { currentOrg, currentProject } = useOrg()
  const navigate = useNavigate()
  const projectId = currentProject?.id ?? null
  const qc = useQueryClient()

  const detailQ = useQuery({
    enabled: !!projectId && !!issueId,
    queryFn: () => adminApi.issueDetail(projectId!, issueId!),
    queryKey: ['issue', projectId, issueId],
  })

  const patchM = useMutation({
    mutationFn: (status: WritableStatus) => adminApi.patchIssue(projectId!, issueId!, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['issue', projectId, issueId] })
      void qc.invalidateQueries({ queryKey: ['issues', projectId] })
    },
  })

  if (!projectId) return <Empty hint="Select a project to load this issue." title="No project" />
  if (!issueId) return null
  if (detailQ.isLoading) return <Empty hint="Loading…" title="Issue" />
  if (detailQ.error || !detailQ.data) return <Empty hint="Failed to load." title="Issue" />

  const d = detailQ.data
  return (
    <div className="space-y-3">
      <Link
        className="text-fg-muted hover:text-fg t-sm inline-flex items-center gap-1"
        to={`/org/${currentOrg.slug}/issues`}
      >
        ← Issues
      </Link>

      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            {d.status !== 'resolved' && (
              <ActionButton
                disabled={patchM.isPending}
                label="Resolve"
                onClick={() => patchM.mutate('resolved')}
              />
            )}
            {d.status !== 'silenced' && (
              <ActionButton
                disabled={patchM.isPending}
                label="Silence"
                onClick={() => patchM.mutate('silenced')}
              />
            )}
            {(d.status === 'resolved' || d.status === 'silenced') && (
              <ActionButton
                disabled={patchM.isPending}
                label="Reopen"
                onClick={() => patchM.mutate('active')}
              />
            )}
          </div>
        }
        subtitle={
          <span className="font-mono">
            <span className="text-fg-muted">{d.errorType}</span>
            {d.lastEnvironment && <span className="text-fg-muted ml-2">· {d.lastEnvironment}</span>}
          </span>
        }
        title={
          <span>
            <StatusText status={d.status} />
            <span className="text-fg ml-2">{d.messageSample}</span>
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Pane title="Fingerprint">
          <div className="text-fg-muted t-md font-mono break-all">{d.fingerprint}</div>
          <div className="text-fg-muted t-sm mt-2">
            First seen <span className="text-fg tabular-nums">{formatRelative(d.firstSeen)}</span>
            <span className="mx-2">·</span>
            Last seen <span className="text-fg tabular-nums">{formatRelative(d.lastSeen)}</span>
          </div>
        </Pane>

        <div className="space-y-3">
          <Pane title="Details">
            <Row label="status">
              <StatusText status={d.status} />
            </Row>
            <Row label="events">
              <span className="text-fg tabular-nums">{d.eventCount.toLocaleString()}</span>
            </Row>
            {d.lastRelease && (
              <Row label="release">
                <span className="text-fg-muted font-mono">{d.lastRelease}</span>
              </Row>
            )}
            {d.lastEnvironment && (
              <Row label="env">
                <span className="text-fg-muted font-mono">{d.lastEnvironment}</span>
              </Row>
            )}
            <Row label="assignee">
              {d.assigneeEmail ? (
                <span className="text-accent">@{d.assigneeEmail.split('@')[0]}</span>
              ) : (
                <span className="text-fg-muted">unassigned</span>
              )}
            </Row>
          </Pane>
        </div>
      </div>

      <div className="text-fg-muted t-sm">
        Stack frames, breadcrumbs, and recent events render here once the v2 detail wiring adds{' '}
        <code className="font-mono">getIssueDetail</code>. The current shell already speaks to{' '}
        <code className="font-mono">getIssue</code> for status / counts.
      </div>

      <button
        className="text-fg-muted hover:text-fg t-sm self-start"
        onClick={() => navigate(`/org/${currentOrg.slug}/issues`)}
        type="button"
      >
        Back to issues
      </button>
    </div>
  )
}

function Pane({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 overflow-hidden rounded-md border">
      <header className="border-border border-b px-3 py-2">
        <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">{title}</span>
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="t-md mb-1.5 flex items-baseline justify-between gap-3 last:mb-0">
      <span className="text-fg-muted t-sm tracking-wide">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
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

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 rounded-md border px-6 py-12 text-center">
      <div className="text-fg-muted t-sm mb-1 font-semibold tracking-wider uppercase">{title}</div>
      <div className="text-fg t-md">{hint}</div>
    </div>
  )
}
