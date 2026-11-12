import { test, expect, resetAll, signIn, mockState } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const folderNames = (page: import('@playwright/test').Page) =>
  page.locator('tbody tr td:nth-child(2) a span.font-medium').allInnerTexts()

test('folder search matches words in any order and across the path', async ({ page }) => {
  await page.goto('/folders')
  const box = page.getByPlaceholder(/Search folders/)
  await box.fill('sci fi')
  await expect.poll(() => folderNames(page)).toEqual(['Sci-Fi Classics 70s'])
  await box.fill('movies classics')
  await expect.poll(() => folderNames(page)).toEqual(['Sci-Fi Classics 70s'])
  await box.fill('zzz-nothing')
  await expect(page.getByText(/No folders match/)).toBeVisible()
})

test('folder page lists real files and explains deleted ones', async ({ page, request }) => {
  const old = (await mockState(request)).folders.find((f) => f.name === 'Old Uploads')!
  await page.goto(`/folders/${old.id}`)
  await expect(page.getByRole('heading', { name: 'Old Uploads' })).toBeVisible()
  // Filester says 2 files; both were deleted.
  await expect(page.getByText(/2 deleted \(Filester still counts them\)/)).toBeVisible()
  await expect(page.getByText(/0 files here/)).toBeVisible()

  const jazz = (await mockState(request)).folders.find((f) => f.name === 'Jazz')!
  await page.goto(`/folders/${jazz.id}`)
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByText(/deleted \(Filester/)).toHaveCount(0)
})

test('files page searches names and folder paths', async ({ page }) => {
  await page.goto('/files')
  const box = page.getByPlaceholder(/Search file names/)
  await box.fill('kyoto')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await box.fill('japan')
  await expect(page.locator('tbody tr')).toHaveCount(2)
})

test('mobile-ish narrow width has no horizontal page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 })
  for (const path of ['/', '/folders', '/files', '/expiring', '/settings']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(1)
  }
})
