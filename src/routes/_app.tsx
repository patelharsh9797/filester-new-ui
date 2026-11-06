import { useEffect } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { getSession } from '../server/auth.functions'
import { setUnauthorizedHandler } from '../lib/api'
import { DialogProvider } from '../state/dialogs'
import { UploadProvider } from '../state/uploads'
import { Layout } from '../components/Layout'

/**
 * Signed-in area. Rendered client-side only: all data is per-user and loaded
 * from Filester in the browser (through /api/fs), so SSR adds nothing here.
 */
export const Route = createFileRoute('/_app')({
  ssr: false,
  beforeLoad: async () => {
    const session = await getSession()
    if (!session) throw redirect({ to: '/login' })
    return { session }
  },
  component: AppShell,
})

function AppShell() {
  const router = useRouter()
  const { queryClient } = Route.useRouteContext()
  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear()
      router.navigate({ to: '/login' })
    })
  }, [router, queryClient])

  return (
    <UploadProvider>
      <DialogProvider>
        <Layout />
      </DialogProvider>
    </UploadProvider>
  )
}
