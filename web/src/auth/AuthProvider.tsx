import { type ReactNode, useEffect, useState } from 'react'

import { type AuthUser, userAuthApi } from '@/api/client'

import { AuthCtx } from './state'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)

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

  const login = async (email: string, password: string) => {
    const r = await userAuthApi.login(email, password)
    setUser(r.user)
    setIsAuthed(true)
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

  return <AuthCtx.Provider value={{ isAuthed, login, logout, user }}>{children}</AuthCtx.Provider>
}
