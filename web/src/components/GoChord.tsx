import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ROUTED_MODULES } from '@/modules/registry'

/**
 * `g <letter>` keyboard chord navigation.
 *
 * Press `g`, then within 1.2 s press a single letter, to jump to the
 * module whose `chord` matches. e.g. `g r` → Runtime, `g h` → Health.
 *
 * The chord is org-scoped: it preserves whatever `/main/org/<slug>`
 * prefix is in the current URL. Outside an org route (login, onboarding,
 * superadmin), the chord is silently inert — no navigation, no flash.
 *
 * Suppressed while:
 *   - target is an input / textarea / contentEditable
 *   - a modifier key is held (cmd / ctrl / alt) — those belong to CmdK
 *     and OS shortcuts
 *   - we're already on the target route (avoid a router no-op rerender)
 *
 * Mounted as a sibling of <CmdK /> in <AppShell />.
 */
export function GoChord() {
  const navigate = useNavigate()
  const location = useLocation()
  const armedAtRef = useRef<null | number>(null)

  useEffect(() => {
    const ARM_WINDOW_MS = 1200

    const isTypingTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (t.isContentEditable) return true
      return false
    }

    const orgPrefix = (): null | string => {
      const m = location.pathname.match(/^(\/main\/org\/[^/]+)\//)
      return m ? m[1]! : null
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      const now = Date.now()
      const armed = armedAtRef.current !== null && now - armedAtRef.current < ARM_WINDOW_MS

      if (!armed) {
        if (e.key === 'g' || e.key === 'G') {
          armedAtRef.current = now
        }
        return
      }

      // Armed — consume the next single keystroke regardless of match.
      armedAtRef.current = null
      const letter = e.key.toLowerCase()
      if (letter.length !== 1 || letter < 'a' || letter > 'z') return

      const prefix = orgPrefix()
      if (!prefix) return

      const target = ROUTED_MODULES.find((m) => m.chord === letter)
      if (!target) return

      const path = `${prefix}/${target.path}`
      if (location.pathname === path || location.pathname.startsWith(`${path}/`)) return

      e.preventDefault()
      navigate(path)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, location.pathname])

  return null
}
