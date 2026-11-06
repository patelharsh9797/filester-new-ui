import { createFileRoute } from '@tanstack/react-router'
import { FolderPage } from '../../../pages/Folder'
import { stringParams } from '../../../lib/searchParams'

export const Route = createFileRoute('/_app/folders/$id')({
  validateSearch: stringParams('fq', 'deep', 'file'),
  component: FolderPage,
})
