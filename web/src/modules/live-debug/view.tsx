// v0.9.3 +S7 — Live Debug Stream viewer.
//
// Operator types a user id → page opens an EventSource against
// `/admin/api/projects/{id}/live-debug/users/{userId}`. Server fans
// out every event tagged with that user.id in near-real-time
// (bounded by SDK batch interval, default ~5 s).
//
// MVP: console-style append-only list. Each row is a minimal event
// summary (timestamp, kind, error type, message) with a "view"
// link that opens the full issue detail in a new tab. 10-minute
// server-side TTL — when the SSE emits `timeout` event the stream
// closes and the page shows a re-arm button.

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

export function LiveDebugView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [userId, setUserId] = useState('')
  const [draft, setDraft] = useState('')
  const [rows, setRows] = useState<LiveRow[]>([])
  const [status, setStatus] = useState<'idle' | 'connected' | 'closed' | 'timeout' | 'error'>(
    'idle'
  )
  const esRef = useRef<EventSource | null>(null)

  function start(id: string) {
    if (!projectId) return
    stop()
    setRows([])
    setStatus('connected')
    // v1.1 +S7 升级 — arm the per-user live-mode flag so the SDK
    // (when it polls /v1/control/poll) switches to immediate-send.
    void fetch(`/admin/api/projects/${projectId}/live-debug/users/${encodeURIComponent(id)}/arm`, {
      credentials: 'include',
      method: 'POST',
    }).catch(() => {
      // best-effort — SSE works either way, just with batch latency.
    })
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
    // Disarm the live-mode flag so the SDK reverts to its normal
    // batched send. Best-effort; if it fails, server TTL (10 min)
    // expires the flag.
    if (projectId && userId) {
      void fetch(
        `/admin/api/projects/${projectId}/live-debug/users/${encodeURIComponent(userId)}/arm`,
        { credentials: 'include', method: 'DELETE' }
      ).catch(() => {
        // ignore
      })
    }
  }

  useEffect(() => () => stop(), [])

  return (
    <div className="space-y-3">
      <section className="border-border rounded-md border p-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const id = draft.trim()
            if (id.length === 0) return
            setUserId(id)
            start(id)
          }}
        >
          <label className="text-fg-muted t-sm font-mono">user.id:</label>
          <input
            className="border-border bg-bg-tertiary text-fg focus:outline-accent t-sm flex-1 rounded border px-2 py-1 font-mono focus:outline focus:outline-1 disabled:opacity-60"
            disabled={status === 'connected'}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sentori.setUser({ id }) value"
            value={draft}
          />
          {status === 'connected' ? (
            <button
              className="border-danger text-danger t-sm rounded border px-3 py-1 font-mono"
              onClick={() => {
                stop()
                setStatus('closed')
              }}
              type="button"
            >
              stop
            </button>
          ) : (
            <button
              className="bg-accent text-bg t-sm rounded px-3 py-1 font-medium"
              disabled={draft.trim().length === 0}
              type="submit"
            >
              start
            </button>
          )}
          <span className={`t-sm font-mono ${statusTone[status]}`}>● {status}</span>
        </form>
      </section>

      <section className="border-border rounded-md border">
        <header className="border-border flex items-center justify-between border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Live event stream {userId && <span className="font-mono">· {userId}</span>}
          </span>
          <span className="text-fg-muted t-sm tabular-nums">{rows.length} events</span>
        </header>
        {rows.length === 0 && (
          <div className="text-fg-muted t-md p-3">
            {status === 'connected'
              ? 'Waiting for events…'
              : 'Set a user id above and click start.'}
          </div>
        )}
        {rows.length > 0 && (
          <table className="std-table w-full">
            <thead>
              <tr>
                <th>received</th>
                <th>kind</th>
                <th>type</th>
                <th>message</th>
                <th>release</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r, i) => (
                  <tr key={`${r.eventId}-${i}`}>
                    <td className="font-mono tabular-nums">
                      {new Date(r.receivedAt).toLocaleTimeString()}
                    </td>
                    <td>
                      <span
                        className={
                          r.kind === 'error'
                            ? 'text-danger font-mono'
                            : r.kind === 'nearCrash'
                              ? 'text-warning font-mono'
                              : 'text-fg-muted font-mono'
                        }
                      >
                        {r.kind}
                      </span>
                    </td>
                    <td className="font-mono">{r.errorType}</td>
                    <td className="t-sm truncate">{r.errorMessage}</td>
                    <td className="font-mono">{r.release}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

const statusTone: Record<string, string> = {
  closed: 'text-fg-muted',
  connected: 'text-success',
  error: 'text-danger',
  idle: 'text-fg-muted',
  timeout: 'text-warning',
}
