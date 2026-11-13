import { test, expect, resetAll, signIn, mockState, MOCK } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const tiles = (page: import('@playwright/test').Page) => page.getByRole('list', { name: 'Files' }).getByRole('listitem')
const views = async (request: import('@playwright/test').APIRequestContext) =>
  Object.fromEntries((await mockState(request)).files.filter((f) => f.views > 0).map((f) => [f.name, f.views]))

test('grid view with thumbnails, remembered across visits', async ({ page }) => {
  await page.goto('/files')
  await page.getByRole('button', { name: 'Grid view' }).click()
  await expect(page).toHaveURL(/view=grid/)
  await expect(tiles(page)).toHaveCount(12)

  // Image tiles show Filester's thumbnail; other files show a type icon.
  const kyoto = tiles(page).filter({ hasText: 'kyoto-temple.jpg' })
  await expect.poll(() => kyoto.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  await expect(tiles(page).filter({ hasText: 'notes-unsorted.md' }).locator('img')).toHaveCount(0)
  await expect(tiles(page).filter({ hasText: 'Blade.Runner.1982.trailer.mp4' }).locator('.lucide-play')).toHaveCount(1)

  await page.goto('/files')
  await expect(tiles(page)).toHaveCount(12)
  await page.getByRole('button', { name: 'List view' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(12)
})

test('a missing thumbnail falls back to the type icon', async ({ page, request }) => {
  expect((await request.post(`${MOCK}/__break`, { data: { what: 'thumbs' } })).ok()).toBe(true)
  await page.goto('/files?view=grid')
  const kyoto = tiles(page).filter({ hasText: 'kyoto-temple.jpg' })
  await expect(kyoto.locator('img')).toHaveCount(0)
  await expect(kyoto.locator('svg').first()).toBeVisible()
})

test('lightbox shows the full image, steps through files, and only counts views for what you stop on', async ({ page, request }) => {
  await page.goto('/files?view=grid&q=jpg')
  await expect(tiles(page)).toHaveCount(4)
  const first = (await tiles(page).first().locator('.text-xs.font-medium').textContent())!
  await tiles(page).first().getByRole('button', { name: /^Open/ }).click()
  const box = page.getByRole('dialog', { name: `Preview: ${first}` })
  await expect(box).toContainText('1 / 4')
  await expect.poll(() => box.locator(`img[alt="${first}"]`).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64)
  expect(await views(request)).toEqual({ [first]: 1 })
  // Filester counts a view, never a download.
  expect((await mockState(request)).files.filter((f) => f.downloads > 0).map((f) => f.name).sort()).toEqual(['Blade.Runner.1982.trailer.mp4', 'kind-of-blue.flac'])

  // Flick through quickly: files you only pass over don't get a view.
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog')).toContainText('4 / 4')
  await page.waitForTimeout(1200)
  const v = await views(request)
  expect(Object.values(v).reduce((a, b) => a + b, 0)).toBe(2)
  await page.keyboard.press('Home')
  await expect(page.getByRole('dialog')).toContainText('1 / 4')
  await page.waitForTimeout(600)
  // Back on the first file: its link is reused, so no extra view.
  expect(await views(request)).toEqual(v)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('videos stream in the lightbox', async ({ page }) => {
  await page.goto('/files?view=grid&q=trailer')
  await tiles(page).first().getByRole('button', { name: /^Open/ }).click()
  const video = page.getByRole('dialog').locator('video')
  await expect(video).toHaveAttribute('src', /\/v2\/.+\.mp4\?token=v/)
})

test('select tiles and move them', async ({ page, request }) => {
  await page.goto('/files?view=grid&q=jpg')
  await expect(tiles(page)).toHaveCount(4)
  await page.getByRole('checkbox', { name: 'Select tokyo-night.jpg' }).check()
  await page.getByRole('checkbox', { name: 'Select kyoto-temple.jpg' }).check()
  await expect(page.getByText('2 selected')).toBeVisible()
  // While selecting, clicking a tile toggles it instead of opening it.
  await tiles(page).filter({ hasText: 'photo (1).jpg' }).getByRole('button').click()
  await expect(page.getByText('3 selected')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await tiles(page).filter({ hasText: 'photo (1).jpg' }).getByRole('button').click()

  await page.getByRole('button', { name: 'Move', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByPlaceholder('Search folders…').fill('old uploads')
  await dlg.getByRole('button', { name: /^Old Uploads/ }).first().click()
  await dlg.getByRole('button', { name: 'Move here' }).click()
  await expect(page.getByText(/Moved 2 files to/)).toBeVisible()
  const s = await mockState(request)
  const old = s.folders.find((f) => f.name === 'Old Uploads')!.id
  expect(s.files.filter((f) => f.folder === old && !f.deleted).map((f) => f.name).sort()).toEqual(['kyoto-temple.jpg', 'tokyo-night.jpg'])
})

test('folder page grid; "Show in folder" still opens the list with the file highlighted', async ({ page, request }) => {
  const japan = (await mockState(request)).folders.find((f) => f.name === 'Trip to Japan 2025')!
  await page.goto(`/folders/${japan.id}`)
  await page.getByRole('button', { name: 'Grid view' }).click()
  await expect(tiles(page)).toHaveCount(2)
  const slug = (await mockState(request)).files.find((f) => f.name === 'tokyo-night.jpg')!.slug
  await page.goto(`/folders/${japan.id}?file=${slug}`)
  await expect(page.locator(`#file-${slug}`)).toBeVisible()
})
