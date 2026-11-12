import type { Page } from '@playwright/test'
import { test, expect, resetAll, signIn, mockState } from './helpers'

// Destructive flows: each test checks the mock's state after every step and
// stops at the first mismatch (expect throws), so a broken selection can never
// cascade into deleting more than intended.

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const dialog = (page: Page) => page.getByRole('dialog')

test('bulk move files into a folder', async ({ page, request }) => {
  await page.goto('/files')
  await page.getByPlaceholder(/Search file names/).fill('.mp3')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await expect(page.getByText('2 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Move', exact: true }).click()
  await dialog(page).getByPlaceholder('Search folders…').fill('photos')
  await dialog(page).getByRole('button', { name: /^Photos/ }).first().click()
  await dialog(page).getByRole('button', { name: 'Move here' }).click()
  await expect(page.getByText(/Moved 2 files to/)).toBeVisible()

  const s = await mockState(request)
  const photos = s.folders.find((f) => f.name === 'Photos')!.id
  expect(s.files.filter((f) => f.name.endsWith('.mp3')).map((f) => f.folder)).toEqual([photos, photos])
  expect(s.files.filter((f) => f.deleted).length).toBe(2) // only the seeded deleted ones
})

test('deleting a folder also deletes its subfolders (Filester leaves orphans)', async ({ page, request }) => {
  await page.goto('/folders')
  await page.getByPlaceholder(/Search folders/).fill('movies')
  await page.getByRole('checkbox', { name: 'Select Movies' }).check()
  await expect(page.getByText('1 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog(page)).toContainText('3 subfolders')
  await expect(dialog(page)).toContainText('3 files')
  await dialog(page).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText(/Deleted 4 folders/)).toBeVisible()

  const s = await mockState(request)
  expect(s.folders.map((f) => f.name)).not.toEqual(expect.arrayContaining(['Movies']))
  expect(s.folders.filter((f) => ['Movies', 'Sci-Fi Classics 70s', 'Horror', 'Slasher'].includes(f.name))).toEqual([])
  expect(s.folders.some((f) => f.orphan)).toBe(false)
  // Everything else untouched.
  expect(s.folders.length).toBe(9)
  expect(s.files.filter((f) => f.deleted).map((f) => f.name).sort()).toEqual(
    ['2001-a-space-odyssey-poster.jpg', 'Blade.Runner.1982.trailer.mp4', 'halloween-1978-notes.txt', 'old-1.jpg', 'old-2.jpg'],
  )
})

test('hide related for several folders at once', async ({ page, request }) => {
  await page.goto('/folders')
  await page.getByPlaceholder(/Search folders/).fill('music')
  for (const n of ['Jazz', 'Lo-fi Beats']) await page.getByRole('checkbox', { name: `Select ${n}` }).check()
  await expect(page.getByText('2 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Hide related' }).click()
  await page.getByRole('menuitem', { name: 'Hide related files' }).click()
  await dialog(page).getByRole('button', { name: /Hide related in 2 folders/ }).click()
  await expect(page.getByText(/Hiding related files in 2 folders/)).toBeVisible()

  const s = await mockState(request)
  expect(s.folders.filter((f) => f.hideRelated).map((f) => f.name).sort()).toEqual(['Jazz', 'Lo-fi Beats'])
  // The password on another folder must survive (Filester wipes it on an empty edit).
  expect(s.folders.find((f) => f.name === 'Locked Vault')!.hasPassword).toBe(true)
})
