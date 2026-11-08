import { createFileRoute } from '@tanstack/react-router'
import { BackupsPage } from '../../pages/Backups'

export const Route = createFileRoute('/_app/backups')({
  head: () => ({ meta: [{ title: 'Backups · Filester Navigator' }] }),
  component: BackupsPage,
})
