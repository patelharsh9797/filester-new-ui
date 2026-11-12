import { test, expect } from './helpers'

test('manifest, service worker and offline page are served', async ({ page, request }) => {
  const m = await (await request.get('/manifest.webmanifest')).json()
  expect(m.display).toBe('standalone')
  expect(m.icons.length).toBeGreaterThan(0)
  expect((await request.get('/sw.js')).ok()).toBe(true)
  const off = await request.get('/offline')
  expect(off.ok()).toBe(true)
  expect(await off.text()).toContain('offline')

  await page.goto('/login')
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), { timeout: 15_000 }).toBe(true)
})
