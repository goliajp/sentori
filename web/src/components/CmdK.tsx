import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { adminApi, type SearchHit } from '@/api/client'

/**
 * Cross-entity Cmd+K / `/` palette.
 *
 * Opens via:
 *   • ⌘K / Ctrl+K from anywhere (toggle)
 *   • `/` outside an input
 *   • The toolbar search button dispatches a synthetic `keydown` so a
 *     mouse-only user can open it without learning the shortcut.
 *
 * Results come from `adminApi.search(q)` (Phase 28 sub-A) — issues,
 * projects, orgs, teams, members. Each hit ships its own `url`, so the
 * palette just calls `navigate(hit.url)` on Enter / click.
 */
export function CmdK() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Global open/close shortcuts. ⌘K toggles. `/` opens if not in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === '/' && !inField && !open) {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Reset + focus whenever the palette opens.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQ('')

    setIdx(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // Debounce typed query.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 120)
    return () => clearTimeout(t)
  }, [q])

  const { data, isFetching } = useQuery({
    enabled: open && debounced.length > 0,
    queryFn: () => adminApi.search(debounced),
    queryKey: ['cmdk', debounced],
    staleTime: 5_000,
  })

  const hits: SearchHit[] = data ?? []
  const safeIdx = hits.length > 0 ? Math.min(idx, hits.length - 1) : 0

  const open_ = (hit: SearchHit) => {
    setOpen(false)
    navigate(hit.url)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="border-border bg-bg w-[36rem] max-w-[92vw] rounded-md border shadow-2xl">
        <div className="border-border border-b px-3 py-2">
          <input
            aria-label="Search"
            className="text-fg t-md placeholder:text-fg-muted w-full bg-transparent font-mono outline-none"
            onChange={(e) => {
              setQ(e.target.value)
              setIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
                e.preventDefault()
                setIdx((i) => Math.min(hits.length - 1, i + 1))
              } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
                e.preventDefault()
                setIdx((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                const hit = hits[safeIdx]
                if (hit) {
                  e.preventDefault()
                  open_(hit)
                }
              }
            }}
            placeholder="Search issues / projects / orgs / teams / members…"
            ref={inputRef}
            value={q}
          />
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {q.length === 0 && (
            <p className="text-fg-muted t-sm px-3 py-3">Start typing to search across this org.</p>
          )}
          {q.length > 0 && isFetching && <p className="text-fg-muted t-sm px-3 py-2">Searching…</p>}
          {q.length > 0 && !isFetching && hits.length === 0 && (
            <p className="text-fg-muted t-sm px-3 py-3">No matches.</p>
          )}
          <ul>
            {hits.map((hit, i) => (
              <li key={`${hit.type}-${hit.id}`}>
                <button
                  className={`group flex w-full items-center gap-3 px-3 py-1.5 text-left ${
                    i === safeIdx ? 'bg-accent/10' : 'hover:bg-bg-tertiary'
                  }`}
                  onClick={() => open_(hit)}
                  onMouseEnter={() => setIdx(i)}
                  type="button"
                >
                  <KindChip kind={hit.type} />
                  <span className="text-fg t-md min-w-0 flex-1 truncate">{hit.label}</span>
                  {hit.sublabel && (
                    <span className="text-fg-muted t-sm shrink-0 truncate">{hit.sublabel}</span>
                  )}
                  <span
                    aria-hidden
                    className={`t-md shrink-0 font-mono transition-opacity ${
                      i === safeIdx ? 'text-accent opacity-100' : 'opacity-0'
                    }`}
                  >
                    ↵
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-border text-fg-muted t-sm flex items-center gap-3 border-t px-3 py-1.5">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

function KindChip({ kind }: { kind: SearchHit['type'] }) {
  // Designed triples (bg / text / border) from the semantic palette,
  // not alpha-on-accent. Reads in both light and dark modes.
  const colour: Record<SearchHit['type'], string> = {
    issue:
      'bg-[color:var(--danger-bg)] text-[color:var(--danger)] border-[color:var(--danger-border)]',
    member: 'bg-[color:var(--accent-soft)] text-[color:var(--accent)] border-[color:var(--accent)]',
    org: 'bg-[color:var(--accent-soft)] text-[color:var(--accent)] border-[color:var(--accent)]',
    project: 'bg-[color:var(--info-bg)] text-[color:var(--info)] border-[color:var(--info-border)]',
    team: 'bg-[color:var(--warning-bg)] text-[color:var(--warning)] border-[color:var(--warning-border)]',
  }
  return (
    <span
      className={`inline-block w-14 shrink-0 border px-1.5 py-px text-center text-[10px] font-medium tracking-[0.12em] uppercase ${colour[kind]}`}
    >
      {kind}
    </span>
  )
}
