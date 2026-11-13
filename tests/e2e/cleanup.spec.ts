import { test, expect, resetAll, signIn, mockState } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const rows = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Empty folders' }).getByRole('listitem').filter({ has: page.getByRole('link') })

test('finds empty folders and tells emptied ones apart', async ({ page }) => {
  await page.getByRole('link', { name: 'Cleanup' }).click()
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).filter({ hasText: 'Old Uploads' })).toContainText('2 files deleted here')
  await expect(rows(page).filter({ hasText: 'Locked Vault' })).toContainText('Never had files')
  await page.getByRole('button', { name: /^Never had files/ }).click()
  await expect(rows(page)).toHaveCount(1)
})

test('keep hides a folder from the list (remembered), and can be undone', async ({ page }) => {
  await page.goto('/cleanup')
  await rows(page).filter({ hasText: 'Locked Vault' }).getByRole('button', { name: 'Keep' }).click()
  await expect(rows(page)).toHaveCount(1)
  await page.reload()
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Show 1 kept folder' }).click()
  await rows(page).filter({ hasText: 'Locked Vault' }).getByRole('button', { name: 'Don’t keep' }).click()
  await page.getByRole('button', { name: 'Back to empty folders' }).click()
  await expect(rows(page)).toHaveCount(2)
})

test('deleting an empty folder also removes its empty subfolders, nothing else', async ({ page, request }) => {
  // An empty folder with an empty subfolder, created through the app.
  await page.evaluate(async () => {
    const make = async (name: string, parent: string) => (await (await fetch('/api/fs/v1/folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, parent, public: 1 }) })).json()).data.identifier
    await make('Summer', await make('Empty Albums', 'root'))
  })
  const before = await mockState(request)

  await page.goto('/cleanup')
  const row = rows(page).filter({ hasText: 'Empty Albums' })
  await expect(row).toContainText('1 empty subfolder')
  await expect(rows(page).filter({ hasText: 'Summer' })).toHaveCount(0) // covered by its parent
  await row.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('1 subfolder')
  await expect(page.getByRole('dialog')).toContainText('0 files')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Deleted 2 folders')).toBeVisible()

  const after = await mockState(request)
  expect(after.folders.map((f) => f.name).sort()).toEqual(before.folders.map((f) => f.name).filter((n) => n !== 'Empty Albums' && n !== 'Summer').sort())
  expect(after.folders.some((f) => f.orphan)).toBe(false)
  expect(after.files.filter((f) => f.deleted).length).toBe(before.files.filter((f) => f.deleted).length)
  await expect(rows(page)).toHaveCount(2)
})
