import { test, expect, resetAll, signIn, mockState } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

const file = (name: string, size: number, mimeType = 'image/jpeg') => ({ name, mimeType, buffer: Buffer.alloc(size, 7) })

test('upload skips a file already in the folder, then Duplicates cleans up', async ({ page, request }) => {
  const japan = (await mockState(request)).folders.find((f) => f.name === 'Trip to Japan 2025')!
  await page.goto(`/folders/${japan.id}`)
  await expect(page.locator('tbody tr')).toHaveCount(2)

  // 1) Same name and size as an existing file → skipped by default.
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('input[type=file]').setInputFiles([file('kyoto-temple.jpg', 16952), file('osaka-castle.jpg', 4000)])
  await expect(dlg.getByText('already there · skip')).toBeVisible()
  await dlg.getByRole('button', { name: 'Upload 1 file' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(3)
  let s = await mockState(request)
  expect(s.files.filter((f) => f.folder === japan.id && !f.deleted).map((f) => f.name).sort())
    .toEqual(['kyoto-temple.jpg', 'osaka-castle.jpg', 'tokyo-night.jpg'])

  // 2) Upload it anyway to create a real duplicate.
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await dlg.locator('input[type=file]').setInputFiles([file('kyoto-temple.jpg', 16952)])
  await dlg.getByLabel('Duplicates').selectOption('none')
  await dlg.getByRole('button', { name: 'Upload 1 file' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(4)

  // 3) The Duplicates page finds it and deletes the extra copy only.
  await page.goto('/duplicates')
  await expect(page.getByText('kyoto-temple.jpg')).toBeVisible()
  await page.getByRole('button', { name: /Delete 1 extra copy/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete copies' }).click()
  await expect(page.getByText('Deleted 1 of 1 copies')).toBeVisible()
  await expect(page.getByText('No duplicates found')).toBeVisible()
  s = await mockState(request)
  const kyoto = s.files.filter((f) => f.name === 'kyoto-temple.jpg')
  expect(kyoto.map((f) => f.deleted).sort()).toEqual([false, true])
  expect(s.files.filter((f) => f.deleted).length).toBe(3) // 2 seeded + the copy
})
