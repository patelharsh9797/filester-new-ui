// Filester Navigator service worker.
//
// Caches ONLY the app's own static files (hashed JS/CSS bundles and icons) so the
// installed app starts fast and shows an offline page without a connection.
// It never caches API responses, server functions or pages that contain your
// data: /api/*, /_serverFn/* and HTML always go to the network.
const VERSION = 'v2'
const STATIC = `fsnav-static-${VERSION}`
const SHELL = `fsnav-shell-${VERSION}`
// Cloudflare serves public/offline.html at /offline (and redirects /offline.html there).
const OFFLINE = '/offline'
const PRECACHE = [OFFLINE, '/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC, SHELL])
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Private data: never cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_serverFn')) return

  // Page loads: always fresh from the network; offline page if there's no connection.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => {
      const page = await caches.match(OFFLINE)
      // A cached redirected response can't answer a navigation; copy it into a plain one.
      return page ? new Response(await page.blob(), { headers: { 'content-type': 'text/html; charset=utf-8' } }) : Response.error()
    }))
    return
  }

  // Hashed build output never changes: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    })())
    return
  }

  // Icons and manifest: serve cached, refresh in the background.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL)
      const hit = await cache.match(req)
      const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res }).catch(() => hit)
      return hit || fresh
    })())
  }
})
