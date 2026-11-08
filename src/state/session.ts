import { useCallback } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { logout } from '../server/auth.functions'

/** The signed-in user (set by the /_app route's beforeLoad). */
export function useSession() {
  return useRouteContext({ from: '/_app' }).session
}

/**
 * Leave the signed-in area with a full page load. Doing it in-app clears the
 * data cache while the signed-in pages are still mounted; they refetch, get 401s
 * and fight the redirect, leaving the layout stuck in its loading state. A full
 * load also guarantees no file data, queues or caches survive the sign-out.
 */
let leaving = false
export function goToLogin() {
  if (leaving) return
  leaving = true
  window.location.replace('/login')
}

export function useSignOut() {
  return useCallback(async () => {
    try {
      await logout()
    } finally {
      goToLogin()
    }
  }, [])
}
