// v2.14 — Live Debug Stream viewer (v3 GDS migration).
//
// Arm a user.id → SSE stream → real-time table of events as they
// land. Useful for "I'm on a call with a customer hitting an error
// RIGHT NOW" workflows.
//
// Wire format unchanged from v0.9.3 (POST /arm → SSE stream →
// DELETE /arm on stop). Server endpoints in
// `server/src/api/live_debug.rs`.

import { Alert, Button, Card, DataTable, EmptyState, Input, PageHeader } from '@goliapkg/gds'
import { useEffect, useRef, useState } from 'react'

import { useOrg } from '@/auth/orgContext'

type LiveRow = {
  errorMessage: string
  errorType: string
  eventId: string
  kind: string
  receivedAt: number
  release: string
}

type Status = 'closed' | 'connected' | 'error' | 'idle' | 'timeout'

const statusTone: Record<Status, string> = {
  closed: 'text-fg-muted',
  connected: 'text-success',
  error: 'text-danger',
  idle: 'text-fg-muted',
  timeout: 'text-warning',
}

const kindTone: Record<string, string> = {
  anr: 'text-warning',
  error: 'text-danger',
  nearCrash: 'text-warning',
}

export function LiveDebugView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [userId, setUserId] = useState('')
  const [draft, setDraft] = useState('')
  const [rows, setRows] = useState<LiveRow[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const esRef = useRef<EventSource | null>(null)

  function start(id: string) {
    if (!projectId) return
    stop()
    setRows([])
    setStatus('connected')
    void fetch(`/admin/api/projects/${projectId}/live-debug/users/${encodeURIComponent(id)}/arm`, {
      credentials: 'include',
      method: 'POST',
    }).catch(() => {})
    const url = `/admin/api/projects/${projectId}/live-debug/users/${encodeURIComponent(id)}`
    const es = new EventSource(url, { withCredentials: true })
    esRef.current = es
    es.addEventListener('event', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data)
        setRows((cur) =>
          [
            ...cur,
            {
              errorMessage: payload?.error?.message ?? '',
              errorType: payload?.error?.type ?? 'Event',
              eventId: payload?.id ?? '',
              kind: payload?.kind ?? 'error',
              receivedAt: Date.now(),
              release: payload?.release ?? '',
            },
          ].slice(-200)
        )
      } catch {
        // ignore malformed frames
      }
    })
    es.addEventListener('timeout', () => {
      setStatus('timeout')
      es.close()
    })
    es.onerror = () => {
      setStatus((s) => (s === 'timeout' ? s : 'error'))
    }
  }

  function stop() {
    esRef.current?.close()
    esRef.current = null
    if (projectId && userId) {
      void fetch(
        `/admin/api/projects/${projectId}/live-debug/users/${encodeURIComponent(userId)}/arm`,
        { credentials: 'include', method: 'DELETE' }
      ).catch(() => {})
    }
  }

  // Intentional empty deps — close the SSE on unmount only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), [])

  const connected = status === 'connected'
  const orderedRows = [...rows].reverse()

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Live debug" />
        <Card>
          <EmptyState
            description="Pick a project from the sidebar to attach a live SSE stream."
            title="No project selected"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <span
            className={`flex items-center gap-1.5 font-mono text-[11px] tracking-[0.05em] ${statusTone[status]}`}
          >
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${
                connected ? 'sentori-live-pulse' : ''
              }`}
            />
            {status}
          </span>
        }
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'live debug' },
        ]}
        subtitle={userId ? `user.id · ${userId}` : 'idle — arm a user.id to start streaming'}
        title="Live debug"
      />

      <Card>
        <header className="border-border/40 mb-3 border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Arm a user.id</h2>
        </header>
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            const id = draft.trim()
            if (id.length === 0) return
            setUserId(id)
            start(id)
          }}
        >
          <label className="flex-1">
            <span className="text-fg-muted mb-1 block font-mono text-[10px] tracking-[0.22em] uppercase">
              user.id
            </span>
            <Input
              disabled={connected}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="value from sentori.setUser({ id })"
              value={draft}
            />
          </label>
          {connected ? (
            <Button
              onClick={() => {
                stop()
                setStatus('closed')
              }}
              type="button"
              variant="danger"
            >
              Stop
            </Button>
          ) : (
            <Button disabled={draft.trim().length === 0} type="submit" variant="primary">
              Arm
            </Button>
          )}
        </form>
      </Card>

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Live event stream</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {rows.length} event{rows.length === 1 ? '' : 's'}
            {rows.length === 200 ? ' (ring full)' : ''}
          </span>
        </header>

        {status === 'error' && (
          <Alert title="Stream errored" variant="danger">
            The SSE connection dropped. Re-arm to retry.
          </Alert>
        )}
        {status === 'timeout' && (
          <Alert title="Stream timed out" variant="warning">
            No events for the armed window. Re-arm to extend.
          </Alert>
        )}

        {rows.length === 0 ? (
          <EmptyState
            description={
              connected
                ? `Waiting for events with user.id = ${userId}. The host SDK enters immediate-send mode while armed; events should land within ~30 s of arming.`
                : 'Arm a user.id above to start streaming live events from this project.'
            }
            title={connected ? 'Listening…' : 'Stream idle'}
          />
        ) : (
          <DataTable<LiveRow>
            columns={[
              {
                key: 'receivedAt',
                label: 'Time',
                width: '110px',
                render: (_v, r) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {new Date(r.receivedAt).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                ),
              },
              {
                key: 'kind',
                label: 'Kind',
                width: '90px',
                render: (_v, r) => (
                  <span className={`${kindTone[r.kind] ?? 'text-fg-muted'} font-mono text-[12px]`}>
                    {r.kind}
                  </span>
                ),
              },
              {
                key: 'errorType',
                label: 'Type',
                width: '140px',
                render: (_v, r) => (
                  <span className="text-fg font-mono text-[12px]">{r.errorType}</span>
                ),
              },
              {
                key: 'errorMessage',
                label: 'Message',
                render: (_v, r) => (
                  <span className="text-fg-secondary block max-w-[60ch] truncate font-mono text-[12px]">
                    {r.errorMessage}
                  </span>
                ),
              },
              {
                key: 'release',
                label: 'Release',
                width: '140px',
                render: (_v, r) => (
                  <span className="text-fg-muted font-mono text-[11px]">{r.release}</span>
                ),
              },
            ]}
            density="compact"
            rowKey={(r, i) => `${r.eventId}-${i ?? 0}`}
            rows={orderedRows}
            striped
          />
        )}
      </Card>
    </div>
  )
}
