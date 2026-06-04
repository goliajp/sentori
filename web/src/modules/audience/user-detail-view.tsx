import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi, type TimelineEntry } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { qk } from '@/api/query-keys'

/**
 * Audience > User detail — v1.1 chunk D.
 *
 * Renders the merged track + error timeline for a given user id over
 * the last 24h. The user id is captured inline (an input) so the
 * operator can paste / type the value they got from logs or the
 * country breakdown click-through.
 *
 * Click-through-from-breakdown is wired in chunk D follow-up; this
 * view is the destination either way.
 */
export function AudienceUserDetailView({ projectId }: { projectId: string }) {
  const [userId, setUserId] = useState('')
  const [submitted, setSubmitted] = useState<null | string>(null)

  return (
    <div className="space-y-6">
      <form
        className="border-border flex items-baseline gap-3 border-b pb-4"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = userId.trim()
          setSubmitted(trimmed.length > 0 ? trimmed : null)
        }}
      >
        <label className="text-accent font-mono text-[11px] tracking-[0.18em] uppercase">
          user id
        </label>
        <input
          className="border-border text-fg focus:border-accent min-w-0 flex-1 border-b bg-transparent py-1 font-mono text-[13px] focus:outline-none"
          onChange={(e) => setUserId(e.target.value)}
          placeholder="e.g. u_abc123"
          value={userId}
        />
        <button
          className="border-border text-fg hover:border-accent hover:text-accent border px-3 py-1 font-mono text-[11px] tracking-[0.18em] uppercase"
          type="submit"
        >
          Load
        </button>
      </form>

      {submitted ? (
        <TimelineList projectId={projectId} userId={submitted} />
      ) : (
        <ModuleEmpty eyebrow="user">Paste a user id to read their last 24h of events.</ModuleEmpty>
      )}
    </div>
  )
}

function TimelineList({ projectId, userId }: { projectId: string; userId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId && !!userId,
    queryFn: () => adminApi.userTimeline(projectId, userId, { limit: 200 }),
    queryKey: qk.audience.userTimeline(projectId, userId),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  if (isLoading && !data)
    return <ModuleEmpty eyebrow="user">{`Loading timeline for ${userId}…`}</ModuleEmpty>
  if (error) return <ModuleEmpty eyebrow="user">Failed to read user timeline.</ModuleEmpty>
  const entries = data ?? []
  if (entries.length === 0) {
    return <ModuleEmpty eyebrow="user">{`No events for ${userId} in the last 24h.`}</ModuleEmpty>
  }

  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">Timeline · {userId}</span>
        <span className="sec-head-sub">
          {entries.length} event{entries.length === 1 ? '' : 's'} · newest first
        </span>
      </header>
      <ul className="pt-3">
        {entries.map((e, i) => (
          <TimelineRow entry={e} key={`${e.t}-${i}`} />
        ))}
      </ul>
    </section>
  )
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const time = new Date(entry.t).toLocaleTimeString()
  if (entry.source === 'error') {
    return (
      <li className="border-border/40 grid grid-cols-[auto_8ch_1fr] items-baseline gap-3 border-b py-2 last:border-b-0">
        <span className="text-fg-muted font-mono text-[11px] tabular-nums">{time}</span>
        <span
          className="font-mono text-[10px] tracking-[0.18em] uppercase"
          style={{ color: 'var(--color-danger)' }}
        >
          error
        </span>
        <span className="text-fg min-w-0 truncate font-mono text-[12px]">
          <span className="text-danger">{entry.errorType}</span>{' '}
          <span className="text-fg-secondary">{entry.message}</span>
        </span>
      </li>
    )
  }
  return (
    <li className="border-border/40 grid grid-cols-[auto_8ch_1fr] items-baseline gap-3 border-b py-2 last:border-b-0">
      <span className="text-fg-muted font-mono text-[11px] tabular-nums">{time}</span>
      <span className="text-accent font-mono text-[10px] tracking-[0.18em] uppercase">
        {entry.name === '$pageview' ? 'page' : 'track'}
      </span>
      <span className="text-fg min-w-0 truncate font-mono text-[12px]">
        <span>{entry.name}</span>
        {entry.route ? <span className="text-fg-secondary ml-2">{entry.route}</span> : null}
      </span>
    </li>
  )
}
