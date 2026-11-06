import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession } from '../server/auth.functions'
import { LoginPage } from '../pages/Login'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await getSession()) throw redirect({ to: '/' })
  },
  head: () => ({ meta: [{ title: 'Sign in · Filester Navigator' }] }),
  component: LoginPage,
})
