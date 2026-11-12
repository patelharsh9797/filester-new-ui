import type { Page } from '@playwright/test'
import { test, expect, resetAll, signIn, MOCK } from './helpers'

// What the user sees when Filester changes a response format the app depends on.

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const breakFilester = async (page: Page, what: 'folders' | 'export' | 'html') =>
  expect((await page.request.post(`${MOCK}/__break`, { data: { what } })).ok()).toBe(true)

async function runCheck(page: Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Check connection' }).click()
  const list = page.getByRole('list', { name: 'Connection check results' })
  await expect(list.locator('li')).toHaveCount(8, { timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Check again' })).toBeEnabled()
  return list
}

test('connection check passes on a healthy account', async ({ page }) => {
  const list = await runCheck(page)
  await expect(list.locator('li[data-status=ok]')).toHaveCount(7)
  await expect(list.locator('li[data-status=skipped]')).toHaveCount(1) // no backup bucket
  await expect(page.getByText(/Everything works/)).toBeVisible()
})

test('a changed folder list is reported clearly, not shown as an empty library', async ({ page }) => {
  await breakFilester(page, 'folders')
  await page.goto('/folders')
  await expect(page.getByText(/Couldn't load your library: Filester changed how “v1\/folders” responds \(item 1\.name is missing\)/)).toBeVisible()

  const list = await runCheck(page)
  await expect(list.locator('li[data-status=changed]')).toHaveCount(1)
  await expect(list.locator('li[data-status=changed]')).toContainText('Folder list')
  await expect(page.getByText(/Filester changed 1 endpoint/)).toBeVisible()
})

test('a changed CSV export falls back to the API and is flagged', async ({ page }) => {
  await breakFilester(page, 'export')
  await page.goto('/files')
  // Still usable through the paginated API.
  await page.getByPlaceholder(/Search file names/).fill('kyoto')
  await expect(page.locator('tbody tr')).toHaveCount(1)

  const list = await runCheck(page)
  const changed = list.locator('li[data-status=changed]')
  await expect(changed).toHaveCount(1)
  await expect(changed).toContainText('column last_downloaded missing')
})

test('a web page instead of data is reported as a change', async ({ page }) => {
  await breakFilester(page, 'html')
  const list = await runCheck(page)
  await expect(list.locator('li').first()).toHaveAttribute('data-status', 'changed')
  await expect(list.locator('li').first()).toContainText('got a web page instead of data')
})
