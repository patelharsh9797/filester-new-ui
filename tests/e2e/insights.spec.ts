import { test, expect, resetAll, signIn, MOCK } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

test('insights shows Filester’s download stats and the library breakdown', async ({ page }) => {
  await page.getByRole('link', { name: 'Insights' }).click()
  await expect(page).toHaveURL(/\/insights/)
  await expect(page.getByText('Downloads · 24 hours').locator('..')).toContainText('42')

  const top = page.getByRole('region', { name: 'Most-downloaded files' })
  await expect(top.locator('li').first()).toContainText('Blade.Runner.1982.trailer.mp4')
  await expect(top.locator('li').first()).toContainText('30')

  // Folder downloads include subfolders: Movies gets the Sci-Fi trailer's 30.
  const folders = page.getByRole('region', { name: 'Most-downloaded folders' })
  await expect(folders.locator('li').first()).toContainText('Movies')
  await expect(folders.locator('li').first()).toContainText('30')

  await expect(page.getByRole('region', { name: 'Largest files' }).locator('li').first()).toContainText('big-12mb.bin')

  // Hover readout on the daily chart.
  const daily = page.getByRole('region', { name: 'Downloads per day' })
  const bars = daily.locator('[aria-hidden] > div')
  await expect(bars).toHaveCount(30)
  await bars.last().hover()
  await expect(daily).toContainText('42 downloads ·')

  // A file link opens its folder with the file highlighted.
  await top.getByRole('link', { name: 'Blade.Runner.1982.trailer.mp4' }).click()
  await expect(page.getByRole('heading', { name: 'Sci-Fi Classics 70s' })).toBeVisible()
})

test('quiet files lists files close to deletion', async ({ page, request }) => {
  expect((await request.post(`${MOCK}/__age`, { data: { days: 33, names: ['take-five.mp3'] } })).ok()).toBe(true)
  await page.goto('/insights')
  const quiet = page.getByRole('region', { name: 'Quiet files' })
  await expect(quiet.getByRole('list', { name: 'Files closest to deletion' }).locator('li')).toHaveCount(1)
  await expect(quiet).toContainText('take-five.mp3')
  await expect(quiet).toContainText(/No activity for 30\+ days\s*1 file/)
})

test('a changed stats format is reported, storage still works', async ({ page, request }) => {
  expect((await request.post(`${MOCK}/__break`, { data: { what: 'stats' } })).ok()).toBe(true)
  await page.goto('/insights')
  await expect(page.getByText(/Couldn't load download stats from Filester: Filester changed how “account\/stats” responds/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Largest files' }).locator('li').first()).toContainText('big-12mb.bin')
})
