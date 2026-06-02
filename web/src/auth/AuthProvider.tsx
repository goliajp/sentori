import { type ReactNode, useCallback, useEffect, useState } from 'react'

import { type AuthUser, userAuthApi } from '@/api/client'

import { AuthCtx } from './state'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)

  // Initial /me probe — promise-chain style (lint-clean: setState
  // happens in a .then handler, which the analyser can see is past
  // the microtask boundary).
  useEffect(() => {
    userAuthApi
      .me()
      .then((r) => {
        setUser(r.user)
        setIsAuthed(true)
      })
      .catch(() => {
        setUser(null)
        setIsAuthed(false)
      })
  }, [])

  /** Re-fetch /me from the server. Call after profile mutations
   *  (display_name / avatar_url) so the toolbar avatar + every
   *  other consumer of `user` refreshes without a page reload. */
  const refresh = useCallback(() => {
    return userAuthApi
      .me()
      .then((r) => {
        setUser(r.user)
        setIsAuthed(true)
      })
      .catch(() => {
        setUser(null)
        setIsAuthed(false)
      })
  }, [])

  const login = async (email: string, password: string) => {
    const r = await userAuthApi.login(email, password)
    setUser(r.user)
    setIsAuthed(true)
    // The login response carries email + id but not display_name /
    // avatar_url — re-fetch /me so the full profile lands and the
    // toolbar avatar shows the right glyph straight away.
    void refresh()
  }

  const logout = async () => {
    try {
      await userAuthApi.logout()
    } catch {
      // ignore — clear locally regardless
    }
    setUser(null)
    setIsAuthed(false)
  }

  return (
    <AuthCtx.Provider value={{ isAuthed, login, logout, refresh, user }}>
      {children}
    </AuthCtx.Provider>
  )
}
