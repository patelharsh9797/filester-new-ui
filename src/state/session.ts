import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouteContext, useRouter } from '@tanstack/react-router'
import { logout } from '../server/auth.functions'

/** The signed-in user (set by the /_app route's beforeLoad). */
export function useSession() {
  return useRouteContext({ from: '/_app' }).session
}

export function useSignOut() {
  const router = useRouter()
  const qc = useQueryClient()
  return useCallback(async () => {
    await logout()
    qc.clear()
    await router.invalidate()
    await router.navigate({ to: '/login' })
  }, [router, qc])
}
