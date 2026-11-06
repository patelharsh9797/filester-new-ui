import { createFileRoute } from '@tanstack/react-router'
import { FilesPage } from '../../pages/Files'
import { stringParams } from '../../lib/searchParams'

export const Route = createFileRoute('/_app/files')({
  validateSearch: stringParams('q', 'kind', 'size', 'age', 'in'),
  head: () => ({ meta: [{ title: 'Files · Filester Navigator' }] }),
  component: FilesPage,
})
