import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { adminApi, type SearchHit } from '@/api/client'

/**
 * Phase 28 sub-A: Cmd+K / Ctrl+K palette.
 *
 * Mounts once at the app shell. `Mod+K` opens; `Esc` / outside-click /
 * navigation closes. Arrow keys / `j`/`k` navigate the result list,
 * `Enter` jumps. We hold the input value debounced (~120ms) so a fast
 * typer doesn't fire ten queries.
 *
 * Recent visits live in localStorage, capped at 10 — surfaces them in
 * the empty-query state so the palette isn't blank when first opened.
 */

const RECENT_KEY = 'sentori:cmdk:recent:v1'
const RECENT_MAX = 10
const DEBOUNCE_MS = 120

type Recent = {
  type: SearchHit['type']
  id: string
  label: string
  sublabel: null | string
  url: string
}

function loadRecent(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.slice(0, RECENT_MAX) as Recent[]
  } catch {
    // ignore
  }
  return []
}

function pushRecent(hit: SearchHit) {
  try {
    const cur = loadRecent().filter((r) => r.url !== hit.url)
    cur.unshift({
      id: hit.id,
      label: hit.label,
      sublabel: hit.sublabel,
      type: hit.type,
      url: hit.url,
    })
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, RECENT_MAX)))
  } catch {
    // ignore
  }
}

export function CmdK() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Global Mod+K listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Auto-focus + reset on open. The setQ/setSelectedIdx calls trigger
  // a cascade (effect → setState → re-render), but they're exactly
  // what we want here — every time the palette opens we need a clean
  // input + focused row 0. Disabling react-hooks/set-state-in-effect
  // for this intentional case.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQ('')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedIdx(0)
      // Defer to let the input mount.
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  // Debounce typed query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [q])

  const { data, isFetching } = useQuery({
    enabled: open && debouncedQ.length > 0,
    queryFn: () => adminApi.search(debouncedQ),
    queryKey: ['cmdk-search', debouncedQ],
    staleTime: 5_000,
  })

  const recent = open && q.length === 0 ? loadRecent() : []
  const hits: SearchHit[] = data ?? []
  const items: SearchHit[] =
    q.length === 0
      ? recent.map((r) => ({
          id: r.id,
          label: r.label,
          sublabel: r.sublabel,
          type: r.type,
          url: r.url,
        }))
      : hits

  // Clamp selection to current list length each render.
  const safeIdx = items.length > 0 ? Math.min(selectedIdx, items.length - 1) : 0

  const go = (hit: SearchHit) => {
    pushRecent(hit)
    setOpen(false)
    navigate(hit.url)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[8vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="border-border bg-bg w-[36rem] max-w-[92vw] rounded-md border shadow-2xl">
        <div className="border-border border-b px-3 py-2">
          <input
            aria-label="Search"
            className="text-fg w-full bg-transparent font-mono text-[14px] outline-none"
            onChange={(e) => {
              setQ(e.target.value)
              setSelectedIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
                e.preventDefault()
                setSelectedIdx((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
                e.preventDefault()
                setSelectedIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                const item = items[safeIdx]
                if (item) {
                  e.preventDefault()
                  go(item)
                }
              }
            }}
            placeholder="Search org / team / project / issue / member…"
            ref={inputRef}
            value={q}
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {q.length === 0 && recent.length === 0 && (
            <p className="text-fg-muted px-3 py-3 text-[12px]">Type to search across your orgs.</p>
          )}
          {q.length === 0 && recent.length > 0 && <SectionLabel label="Recent" />}
          {q.length > 0 && isFetching && (
            <p className="text-fg-muted px-3 py-2 text-[12px]">Searching…</p>
          )}
          {q.length > 0 && !isFetching && hits.length === 0 && (
            <p className="text-fg-muted px-3 py-3 text-[12px]">No matches.</p>
          )}
          <ul>
            {items.map((hit, i) => (
              <li key={`${hit.type}-${hit.id}`}>
                <button
                  className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-[13px] ${
                    i === safeIdx ? 'bg-accent/10' : 'hover:bg-bg-tertiary'
                  }`}
                  onClick={() => go(hit)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  type="button"
                >
                  <KindChip kind={hit.type} />
                  <span className="text-fg truncate">{hit.label}</span>
                  {hit.sublabel && (
                    <span className="text-fg-muted ml-auto truncate text-[11px]">
                      {hit.sublabel}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-border text-fg-muted flex items-center gap-3 border-t px-3 py-1.5 text-[10px]">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="text-fg-muted px-3 pt-2 pb-1 text-[10px] tracking-wider uppercase">{label}</div>
  )
}

function KindChip({ kind }: { kind: SearchHit['type'] }) {
  const colour: Record<SearchHit['type'], string> = {
    issue: 'bg-red-500/15 text-red-300',
    member: 'bg-violet-500/15 text-violet-300',
    org: 'bg-accent/10 text-accent',
    project: 'bg-blue-500/15 text-blue-300',
    team: 'bg-amber-500/15 text-amber-300',
  }
  return (
    <span
      className={`inline-block w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-medium tracking-wide uppercase ${colour[kind]}`}
    >
      {kind}
    </span>
  )
}
