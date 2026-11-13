import { test, expect, resetAll, signIn, mockState } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const dialog = (page: import('@playwright/test').Page) => page.getByRole('dialog')

test('rename by pattern with numbering; files stay in their folder', async ({ page, request }) => {
  const japan = (await mockState(request)).folders.find((f) => f.name === 'Trip to Japan 2025')!
  await page.goto(`/folders/${japan.id}?view=list`)
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(dialog(page).getByRole('heading', { name: 'Rename 2 files' })).toBeVisible()
  await dialog(page).getByLabel('Pattern').fill('{folder} {n}')
  await dialog(page).getByLabel('Order').selectOption('name')
  const preview = dialog(page).getByRole('list', { name: 'Preview' })
  await expect(preview.getByRole('listitem').nth(0)).toContainText('Trip to Japan 2025 1.jpg')
  await expect(preview.getByRole('listitem').nth(1)).toContainText('Trip to Japan 2025 2.jpg')
  await dialog(page).getByRole('button', { name: 'Rename 2 files' }).click()
  await expect(page.getByText('Renamed 2 files')).toBeVisible()

  const s = await mockState(request)
  const inJapan = s.files.filter((f) => f.folder === japan.id && !f.deleted)
  expect(inJapan.map((f) => f.name).sort()).toEqual(['Trip to Japan 2025 1.jpg', 'Trip to Japan 2025 2.jpg'])
  // "kyoto" sorts before "tokyo", so it became number 1.
  expect(s.files.find((f) => f.name === 'Trip to Japan 2025 1.jpg')!.size).toBe(16952)
  await expect(page.locator('tbody')).toContainText('Trip to Japan 2025 1.jpg')
})

test('a pattern that would give two files the same name is blocked', async ({ page, request }) => {
  await page.goto('/files?q=jpg&view=list')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await dialog(page).getByLabel('Pattern').fill('cover')
  await expect(dialog(page).getByText(/name clash/)).toBeVisible()
  await expect(dialog(page).getByRole('button', { name: /^Rename \d+ files?$/ })).toBeDisabled()
  // Per-folder numbering fixes it.
  await dialog(page).getByLabel('Pattern').fill('cover {n}')
  await expect(dialog(page).getByRole('button', { name: 'Rename 4 files' })).toBeEnabled()
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  expect((await mockState(request)).files.some((f) => f.name.startsWith('cover'))).toBe(false)
})

test('find & replace from the gallery keeps extensions', async ({ page, request }) => {
  await page.goto('/files?q=mp3&view=grid')
  await page.getByRole('checkbox', { name: 'Select take-five.mp3' }).check()
  await page.getByRole('checkbox', { name: 'Select study-mix-vol3.mp3' }).check()
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await dialog(page).getByRole('tab', { name: 'Find & replace' }).click()
  await dialog(page).getByLabel('Find').fill('-')
  await dialog(page).getByLabel('Replace with').fill(' ')
  await dialog(page).getByRole('button', { name: 'Rename 2 files' }).click()
  await expect(page.getByText('Renamed 2 files')).toBeVisible()
  const names = (await mockState(request)).files.map((f) => f.name)
  expect(names).toEqual(expect.arrayContaining(['take five.mp3', 'study mix vol3.mp3']))
  expect(names).not.toContain('take-five.mp3')
})
