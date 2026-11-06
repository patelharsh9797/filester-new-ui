import type { ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Link, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import appCss from '../index.css?url'
import { ToastProvider } from '../state/toast'

const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'><path d='M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/></svg>"

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'robots', content: 'noindex, nofollow' },
      { title: 'Filester Navigator' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: FAVICON },
    ],
  }),
  component: () => (
    <RootDocument>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </RootDocument>
  ),
  notFoundComponent: () => (
    <div className="min-h-full grid place-items-center p-6 text-center">
      <div>
        <p className="font-medium">Page not found</p>
        <Link to="/" className="text-sm text-accent-ink underline">Go to overview</Link>
      </div>
    </div>
  ),
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
