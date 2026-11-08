import { useEffect, type ReactNode } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Link, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import appCss from '../index.css?url'
import { ToastProvider } from '../state/toast'
import { registerServiceWorker } from '../lib/pwa'

const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23f59e0b'><path d='M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/></svg>"

const PWA_BOOT = `
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__fsnavInstall = e; window.dispatchEvent(new Event('fsnav-installable')); });
window.addEventListener('appinstalled', function () { window.__fsnavInstall = null; try { localStorage.setItem('fsnav.install', 'installed'); } catch (_) {} window.dispatchEvent(new Event('fsnav-installed')); });
`

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#15161c' },
      { name: 'application-name', content: 'Filester' },
      // iOS home-screen app
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Filester' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black' },
      { name: 'robots', content: 'noindex, nofollow' },
      { title: 'Filester Navigator' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { rel: 'icon', href: FAVICON, type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <div className="min-h-full grid place-items-center p-6 text-center">
      <div>
        <p className="font-medium">Page not found</p>
        <Link to="/" className="text-sm text-accent-ink underline">Go to overview</Link>
      </div>
    </div>
  ),
})

function RootComponent() {
  useEffect(() => registerServiceWorker(), [])
  return (
    <RootDocument>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Chrome/Edge fire beforeinstallprompt early, often before React hydrates: keep it for the install popup. */}
        <script dangerouslySetInnerHTML={{ __html: PWA_BOOT }} />
      </head>
      <body>
        <div id="root">{children}</div>
        <Scripts />
      </body>
    </html>
  )
}
