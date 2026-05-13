import { useEffect } from 'react'
import { useNavigate } from 'react-router'

// `g` then a target letter within this window navigates to that view.
const SEQUENCE_WINDOW_MS = 800

const TARGETS: Record<string, string> = {
  a: 'alerts',
  i: 'issues',
  o: 'overview',
  r: 'releases',
  s: 'settings',
  t: 'traces',
  u: 'audit',
  // 'm' for teams — `g t` is Traces, so Teams gets the other obvious letter.
  m: 'teams',
}

function isEditingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  const tag = el?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el?.isContentEditable) return true
  return false
}

/**
 * Linear-style `g <letter>` navigation: press `g`, then within ~0.8 s
 * press one of `o / i / t / r / m / a / u / s` to jump to that view.
 * Disabled while an input / textarea / contentEditable is focused.
 */
export function useGoToShortcuts(orgSlug: string): void {
  const navigate = useNavigate()
  useEffect(() => {
    if (!orgSlug) return
    let armed = false
    let timer: null | ReturnType<typeof setTimeout> = null
    const disarm = () => {
      armed = false
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditingTarget(e.target)) return
      if (!armed) {
        if (e.key === 'g') {
          armed = true
          timer = setTimeout(disarm, SEQUENCE_WINDOW_MS)
        }
        return
      }
      // armed: the next keystroke decides
      const target = TARGETS[e.key.toLowerCase()]
      disarm()
      if (target) {
        e.preventDefault()
        navigate(`/org/${orgSlug}/${target}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      disarm()
      window.removeEventListener('keydown', onKey)
    }
  }, [navigate, orgSlug])
}
