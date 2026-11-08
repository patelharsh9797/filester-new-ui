import { createFileRoute } from '@tanstack/react-router'
import { FoldersPage } from '../../../pages/Folders'
import { stringParams } from '../../../lib/searchParams'

export const Route = createFileRoute('/_app/folders/')({
  validateSearch: stringParams('q', 'vis', 'show', 'view', 'sort', 'dir', 'hr'),
  head: () => ({ meta: [{ title: 'Folders · Filester Navigator' }] }),
  component: FoldersPage,
})
