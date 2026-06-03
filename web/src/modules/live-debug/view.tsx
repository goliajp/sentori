// v0.9.3 +S7 — Live Debug Stream viewer.

import { useEffect, useRef, useState } from 'react'

import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

type LiveRow = {
  errorMessage: string
  errorType: string
  eventId: string
  kind: string
  receivedAt: number
  release: string
}

type Status = 'closed' | 'connected' | 'error' | 'idle' | 'timeout'

export function LiveDebugView() {
  const { currentProject } = useOrg()
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

  // Intentional empty deps — `stop` is a closure that re-references
  // the latest `esRef`, `projectId`, `userId` via refs. We only want
  // this to fire on unmount, never on re-render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), [])

  const connected = status === 'connected'

  return (
    <div className="sentori-page-in">
      <PageHeader
        actions={
          <span
            className={`flex items-center gap-1.5 font-mono text-[11px] tracking-[0.05em] ${
              statusTone[status]
            }`}
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
        subtitle={userId ? `user.id · ${userId}` : 'idle'}
        title="Live debug"
      />

      {/* Connect form — flush against page-head, no card chrome */}
      <form
        className="border-border flex items-center gap-3 border-b py-3"
        onSubmit={(e) => {
          e.preventDefault()
          const id = draft.trim()
          if (id.length === 0) return
          setUserId(id)
          start(id)
        }}
      >
        <label
          className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase"
          htmlFor="live-userid"
        >
          user.id
        </label>
        <input
          className="border-border text-fg placeholder:text-fg-muted focus:border-accent flex-1 border-b bg-transparent px-0 py-1 font-mono text-[13px] focus:outline-none disabled:opacity-50"
          disabled={connected}
          id="live-userid"
          onChange={(e) => setDraft(e.target.value)}
          placeholder="value from sentori.setUser({ id })"
          value={draft}
        />
        {connected ? (
          <button
            className="border-danger text-danger hover:bg-danger/15 border px-3 py-1 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors"
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
            className="bg-accent text-bg px-3 py-1 font-mono text-[11px] tracking-[0.1em] uppercase disabled:cursor-not-allowed disabled:opacity-50"
            disabled={draft.trim().length === 0}
            type="submit"
          >
            arm
          </button>
        )}
      </form>

      {/* Live stream */}
      {rows.length === 0 ? (
        <div className="border-border text-fg-secondary border-b py-8 text-center text-[13px]">
          {connected
            ? 'Waiting for events from this user.id…'
            : 'Arm a user.id to start streaming.'}
        </div>
      ) : (
        <table className="bench">
          <thead>
            <tr>
              <th>time</th>
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
                  <td className="num">
                    {new Date(r.receivedAt).toLocaleTimeString('en-US', { hour12: false })}
                  </td>
                  <td>
                    <span className={kindTone[r.kind] ?? 'text-fg-muted'}>{r.kind}</span>
                  </td>
                  <td className="lead">{r.errorType}</td>
                  <td className="text-fg-secondary max-w-[40ch] truncate">{r.errorMessage}</td>
                  <td>{r.release}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

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
