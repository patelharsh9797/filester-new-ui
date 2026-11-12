import { createFileRoute } from '@tanstack/react-router'
import { InsightsPage } from '../../pages/Insights'

export const Route = createFileRoute('/_app/insights')({
  head: () => ({ meta: [{ title: 'Insights · Filester Navigator' }] }),
  component: InsightsPage,
})
