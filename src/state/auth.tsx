import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setApiSession, setUnauthorizedHandler } from '../lib/api'
import { loadSession, saveSession, type Session } from '../lib/session'

interface AuthCtx {
  session: Session | null
  signIn: (s: Session) => void
  signOut: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(() => {
    const s = loadSession()
    setApiSession(s)
    return s
  })

  const signIn = useCallback((s: Session) => {
    setApiSession(s)
    saveSession(s)
    setSession(s)
  }, [])

  const signOut = useCallback(() => {
    setApiSession(null)
    saveSession(null)
    setSession(null)
    qc.clear()
  }, [qc])

  useEffect(() => setUnauthorizedHandler(signOut), [signOut])

  return <Ctx.Provider value={{ session, signIn, signOut }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
