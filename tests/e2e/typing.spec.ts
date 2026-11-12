import { test, expect, resetAll, signIn, mockState } from './helpers'

// Search boxes mirror their text into the URL. Typing fast must never drop or
// reorder characters, and outside changes (Clear, saved searches) must still show.

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const TEXT = 'blade runner trailer'

async function typeFast(page: import('@playwright/test').Page, placeholder: RegExp) {
  const box = page.getByPlaceholder(placeholder)
  await box.click()
  await box.pressSequentially(TEXT, { delay: 0 })
  await expect(box).toHaveValue(TEXT)
  // …and the URL catches up once typing stops.
  await expect.poll(() => new URL(page.url()).searchParams.get('q') ?? new URL(page.url()).searchParams.get('fq')).toBe(TEXT)
  await page.waitForTimeout(400)
  await expect(box).toHaveValue(TEXT)
  return box
}

for (const [path, placeholder] of [['/files', /Search file names/], ['/folders', /Search folders/], ['/expiring?within=all', /Search these files/]] as const) {
  test(`fast typing keeps every character on ${path.split('?')[0]}`, async ({ page }) => {
    await page.goto(path)
    const box = await typeFast(page, placeholder)
    await page.getByRole('button', { name: 'Clear' }).first().click()
    await expect(box).toHaveValue('')
    await page.waitForTimeout(400)
    await expect(box).toHaveValue('')
    expect(new URL(page.url()).searchParams.get('q')).toBeNull()
  })
}

test('fast typing in a folder’s file search', async ({ page, request }) => {
  const scifi = (await mockState(request)).folders.find((f) => f.name === 'Sci-Fi Classics 70s')!
  await page.goto(`/folders/${scifi.id}`)
  await typeFast(page, /Search files in this folder/)
})

test('opening a saved search fills the box', async ({ page }) => {
  await page.goto('/files?q=kyoto')
  await expect(page.getByPlaceholder(/Search file names/)).toHaveValue('kyoto')
  await page.goto('/files')
  await page.goBack()
  await expect(page.getByPlaceholder(/Search file names/)).toHaveValue('kyoto')
})
