import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { useAuth } from '@/auth/state'
import { gravatarFor } from '@/views/account'

/**
 * GitHub-style account dropdown. Click the avatar → menu opens with
 * the user's email + Account / Sign out options. Closes on:
 *   - outside click
 *   - menu-item click
 *   - escape key
 */
export function AccountMenu() {
  const { logout, user } = useAuth()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  const avatar = user.avatarUrl || gravatarFor(user.email)
  const label = user.displayName || localPart(user.email)

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open account menu"
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-[color:var(--rule)] transition-colors hover:border-[color:var(--accent)]"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <img alt="" className="h-full w-full object-cover" src={avatar} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 z-50 mt-2 w-60 border border-[color:var(--rule)] bg-[color:var(--paper)] shadow-xl"
          role="menu"
        >
          <div className="border-b border-[color:var(--rule)] px-3 py-3">
            <div className="text-[13px] font-medium text-[color:var(--ink)]">{label}</div>
            <div className="font-mono text-[11px] text-[color:var(--ink-muted)]">{user.email}</div>
          </div>
          <ul className="py-1">
            <li>
              <Link
                className="block px-3 py-1.5 text-[13px] text-[color:var(--ink)] hover:bg-[color:var(--paper-2)] hover:text-[color:var(--accent)]"
                onClick={() => setOpen(false)}
                role="menuitem"
                to="/account"
              >
                Account
              </Link>
            </li>
            <li>
              <Link
                className="block px-3 py-1.5 text-[13px] text-[color:var(--ink)] hover:bg-[color:var(--paper-2)] hover:text-[color:var(--accent)]"
                onClick={() => setOpen(false)}
                role="menuitem"
                to="/me/activity"
              >
                Activity
              </Link>
            </li>
          </ul>
          <div className="border-t border-[color:var(--rule)] py-1">
            <button
              className="block w-full px-3 py-1.5 text-left text-[13px] text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-2)] hover:text-[color:var(--accent)]"
              onClick={() => {
                setOpen(false)
                void logout()
              }}
              role="menuitem"
              type="button"
            >
              ⎋ Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function localPart(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}
