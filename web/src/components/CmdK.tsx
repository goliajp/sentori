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
      aria-modal
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
      role="dialog"
      style={{ background: 'rgb(from var(--ink) r g b / 0.32)' }}
    >
      <div
        className="w-[40rem] max-w-[92vw] overflow-hidden border border-[color:var(--rule)] bg-[color:var(--paper)]"
        style={{ boxShadow: '0 24px 64px -16px rgb(from var(--ink) r g b / 0.5)' }}
      >
        {/* Search input — paper-toned, hairline bottom rule. No
         *  rounded corners, no thick focus halo: a single accent
         *  underline appears via the caret + the label tag. */}
        <div className="flex items-baseline gap-3 border-b border-[color:var(--rule)] px-5 py-3">
          <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
            Search
          </span>
          <input
            aria-label="Search"
            className="min-w-0 flex-1 bg-transparent font-sans text-[15px] text-[color:var(--ink)] caret-[color:var(--accent)] placeholder:text-[color:var(--ink-muted)] focus:outline-none"
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
            placeholder="issues · projects · orgs · teams · members"
            ref={inputRef}
            value={q}
          />
          <span className="hidden font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase sm:inline">
            ⌘K
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {q.length === 0 && (
            <p className="px-5 py-4 text-[12px] text-[color:var(--ink-muted)]">
              Start typing to search across this org.
            </p>
          )}
          {q.length > 0 && isFetching && (
            <p className="px-5 py-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink-muted)]">
              searching…
            </p>
          )}
          {q.length > 0 && !isFetching && hits.length === 0 && (
            <p className="px-5 py-4 text-[12px] text-[color:var(--ink-muted)]">No matches.</p>
          )}
          <ul>
            {hits.map((hit, i) => {
              const active = i === safeIdx
              return (
                <li key={`${hit.type}-${hit.id}`}>
                  <button
                    className={`group relative flex w-full items-center gap-3 border-l-2 px-5 py-2 text-left transition-colors ${
                      active
                        ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)]'
                        : 'border-transparent hover:bg-[color:var(--paper-2)]'
                    }`}
                    onClick={() => open_(hit)}
                    onMouseEnter={() => setIdx(i)}
                    type="button"
                  >
                    <KindChip kind={hit.type} />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[color:var(--ink)]">
                      {hit.label}
                    </span>
                    {hit.sublabel && (
                      <span className="shrink-0 truncate font-mono text-[11px] text-[color:var(--ink-muted)]">
                        {hit.sublabel}
                      </span>
                    )}
                    <span
                      aria-hidden
                      className={`shrink-0 font-mono text-[12px] transition-opacity ${
                        active ? 'text-[color:var(--accent)] opacity-100' : 'opacity-0'
                      }`}
                    >
                      ↵
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="flex items-center gap-4 border-t border-[color:var(--rule)] bg-[color:var(--paper-2)] px-5 py-2 font-mono text-[10px] tracking-[0.15em] text-[color:var(--ink-muted)] uppercase">
          <span>
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-1 inline-block border border-[color:var(--rule)] bg-[color:var(--paper)] px-1.5 py-px font-mono text-[10px] tracking-normal text-[color:var(--ink-soft)]">
      {children}
    </span>
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
