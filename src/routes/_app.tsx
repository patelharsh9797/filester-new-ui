import { useEffect } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '../server/auth.functions'
import { setUnauthorizedHandler } from '../lib/api'
import { DialogProvider } from '../state/dialogs'
import { UploadProvider } from '../state/uploads'
import { BackupProvider } from '../state/backups'
import { TaskProvider } from '../state/tasks'
import { Layout } from '../components/Layout'
import { InstallPrompt } from '../components/InstallPrompt'
import { goToLogin } from '../state/session'

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
  // Session expired or revoked while using the app: same clean exit as signing out.
  useEffect(() => setUnauthorizedHandler(goToLogin), [])

  return (
    <UploadProvider>
      <BackupProvider>
        <TaskProvider>
          <DialogProvider>
            <Layout />
            <InstallPrompt />
          </DialogProvider>
        </TaskProvider>
      </BackupProvider>
    </UploadProvider>
  )
}
