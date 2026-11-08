import { createFileRoute } from '@tanstack/react-router'
import { ExpiringPage } from '../../pages/Expiring'
import { stringParams } from '../../lib/searchParams'

export const Route = createFileRoute('/_app/expiring')({
  validateSearch: stringParams('within', 'q', 'sort', 'dir', 'backup', 'kind'),
  head: () => ({ meta: [{ title: 'Expiring soon · Filester Navigator' }] }),
  component: ExpiringPage,
})
