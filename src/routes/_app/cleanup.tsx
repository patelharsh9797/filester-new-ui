import { createFileRoute } from '@tanstack/react-router'
import { CleanupPage } from '../../pages/Cleanup'

export const Route = createFileRoute('/_app/cleanup')({
  head: () => ({ meta: [{ title: 'Cleanup · Filester Navigator' }] }),
  component: CleanupPage,
})
