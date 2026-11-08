import { createFileRoute } from '@tanstack/react-router'
import { DuplicatesPage } from '../../pages/Duplicates'
import { stringParams } from '../../lib/searchParams'

export const Route = createFileRoute('/_app/duplicates')({
  validateSearch: stringParams('in', 'match'),
  head: () => ({ meta: [{ title: 'Duplicates · Filester Navigator' }] }),
  component: DuplicatesPage,
})
