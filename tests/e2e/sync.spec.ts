import type { Browser, Page } from '@playwright/test'
import { test, expect, resetAll, signIn, fakeTurnstile } from './helpers'

// Two separate browsers signed in to the same account stand in for a laptop and a phone.
async function device(browser: Browser, who: 'alice' | 'bob' = 'alice') {
  const ctx = await browser.newContext()
  await fakeTurnstile(ctx)
  const page = await ctx.newPage()
  await signIn(page, who)
  return page
}
const pinned = (page: Page) => page.getByRole('region', { name: 'Pinned folders' })
const saved = (page: Page) => page.getByRole('region', { name: 'Saved searches' })
async function pin(page: Page, q: string) {
  await page.goto(`/folders?q=${encodeURIComponent(q)}`)
  await page.locator('tbody tr').first().getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click()
}
const serverCopy = (page: Page) => page.evaluate(async () => (await (await fetch('/api/prefs')).json()) as { enabled: boolean; prefs: { folders: string[] } | null })
const syncSwitch = (page: Page) => page.getByRole('switch', { name: 'Sync pinned folders and saved searches' })

test.beforeEach(async ({ request }) => resetAll(request))

test('pins and saved searches sync between devices once turned on', async ({ browser }) => {
  const laptop = await device(browser)
  const phone = await device(browser)

  // Off by default: each browser keeps its own.
  await pin(laptop, 'jazz')
  await pin(phone, 'japan')
  await phone.reload()
  await expect(pinned(phone).getByRole('listitem')).toHaveCount(1)
  expect((await serverCopy(laptop)).enabled).toBe(false)

  // The laptop also saves a search, then turns sync on.
  await laptop.goto('/files?q=kyoto')
  await laptop.getByRole('button', { name: 'Save search' }).click()
  await laptop.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await laptop.goto('/settings')
  await syncSwitch(laptop).click()
  await expect(syncSwitch(laptop)).toHaveAttribute('aria-checked', 'true')

  // The phone merges its own pin in rather than losing it.
  await phone.reload()
  await expect(pinned(phone)).toContainText('Jazz')
  await expect(pinned(phone)).toContainText('Trip to Japan 2025')
  await expect(saved(phone)).toContainText('kyoto')
  await expect.poll(async () => (await serverCopy(phone)).prefs?.folders.length).toBe(2)
  await laptop.reload()
  await expect(pinned(laptop)).toContainText('Trip to Japan 2025')

  // A change on one device reaches the other.
  await pinned(laptop).getByRole('listitem').filter({ hasText: 'Jazz' }).hover()
  await laptop.getByRole('button', { name: 'Unpin Jazz' }).click()
  await expect.poll(async () => (await serverCopy(laptop)).prefs?.folders.length, { timeout: 5000 }).toBe(1)
  await phone.reload()
  await expect(pinned(phone).getByRole('listitem')).toHaveCount(1)
  await expect(pinned(phone)).not.toContainText('Jazz')

  // Turning it off deletes the server copy; both browsers keep what they have.
  await phone.goto('/settings')
  await expect(syncSwitch(phone)).toHaveAttribute('aria-checked', 'true')
  await syncSwitch(phone).click()
  await expect(syncSwitch(phone)).toHaveAttribute('aria-checked', 'false')
  expect((await serverCopy(phone)).enabled).toBe(false)
  await laptop.reload()
  await expect(pinned(laptop)).toContainText('Trip to Japan 2025')

  // Another account never sees it.
  const other = await device(browser, 'bob')
  expect((await serverCopy(other)).enabled).toBe(false)
  await expect(pinned(other)).toHaveCount(0)
})

test('the synced copy is validated and size-limited on the server', async ({ browser }) => {
  const page = await device(browser)
  const status = (body: unknown) => page.evaluate(async (b) => (await fetch('/api/prefs', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status, body)
  expect(await status({ nope: true })).toBe(400)
  expect(await status({ folders: Array(600).fill('a'), searches: [] })).toBe(400)
  expect(await status({ folders: ['x'.repeat(200000)], searches: [] })).toBe(413)
  expect(await status({ folders: ['abc'], searches: [] })).toBe(200)
})
