import { test, expect, resetAll, signIn } from './helpers'

test.beforeEach(async ({ page, request }) => {
  await resetAll(request)
  await signIn(page)
})

test('pin folders to the sidebar, reorder, open and unpin', async ({ page }) => {
  const pinned = page.getByRole('region', { name: 'Pinned folders' })
  await expect(pinned).toHaveCount(0)

  // Pin from the Folders list menu.
  await page.goto('/folders?q=jazz')
  await page.locator('tbody tr').first().getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click()
  await expect(pinned.getByRole('link', { name: /Jazz/ })).toBeVisible()

  // Pin from a folder page's own menu.
  await page.goto('/folders?q=japan')
  await page.locator('tbody tr').first().getByRole('link').first().click()
  await page.getByRole('button', { name: 'Folder actions' }).click()
  await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click()
  await expect(pinned.getByRole('listitem')).toHaveCount(2)
  await expect(pinned.getByRole('listitem').nth(1)).toContainText('Trip to Japan 2025')

  // Reorder, survive a reload, open.
  await pinned.getByRole('listitem').nth(1).hover()
  await pinned.getByRole('button', { name: 'Move Trip to Japan 2025 up' }).click()
  await page.reload()
  await expect(pinned.getByRole('listitem').first()).toContainText('Trip to Japan 2025')
  await pinned.getByRole('link', { name: /Jazz/ }).click()
  await expect(page.getByRole('heading', { name: 'Jazz' })).toBeVisible()

  // The menu now offers to unpin.
  await page.getByRole('button', { name: 'Folder actions' }).click()
  await page.getByRole('menuitem', { name: 'Unpin from sidebar' }).click()
  await expect(pinned.getByRole('listitem')).toHaveCount(1)
})

test('save a search with its filters and reopen it from the sidebar', async ({ page }) => {
  await page.goto('/files')
  await expect(page.getByRole('button', { name: 'Save search' })).toHaveCount(0) // nothing to save yet
  await page.getByPlaceholder(/Search file names/).fill('jpg')
  await page.getByRole('button', { name: /^Image/ }).click()
  await page.getByRole('button', { name: 'Save search' }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('textbox')).toHaveValue('“jpg” · Image')
  await dlg.getByRole('textbox').fill('Photos to sort')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: /Saved as Photos to sort/ })).toBeVisible()

  const saved = page.getByRole('region', { name: 'Saved searches' })
  await page.goto('/folders')
  await saved.getByRole('button', { name: 'Photos to sort', exact: true }).click()
  await expect(page).toHaveURL(/\/files\?/)
  await expect(page.getByPlaceholder(/Search file names/)).toHaveValue('jpg')
  const rows = await page.locator('tbody tr').count()
  expect(rows).toBeGreaterThan(0)
  for (const t of await page.locator('tbody tr td:nth-child(2)').allInnerTexts()) expect(t.toLowerCase()).toContain('jpg')

  // Rename, then remove from the sidebar.
  await saved.getByRole('listitem').hover()
  await saved.getByRole('button', { name: 'Rename Photos to sort' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('JPGs')
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click()
  await expect(saved.getByRole('button', { name: 'JPGs', exact: true })).toBeVisible()
  await saved.getByRole('listitem').hover()
  await saved.getByRole('button', { name: 'Remove JPGs' }).click()
  await expect(saved).toHaveCount(0)
})

test('pins belong to one Filester account', async ({ page }) => {
  await page.goto('/folders?q=jazz')
  await page.locator('tbody tr').first().getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('menuitem', { name: 'Pin to sidebar' }).click()
  await expect(page.getByRole('region', { name: 'Pinned folders' })).toBeVisible()

  // Same browser profile, different account: nothing pinned.
  await page.goto('/settings')
  await page.getByRole('button', { name: /sign out/i }).first().click()
  await expect(page).toHaveURL(/\/login/)
  await signIn(page, 'bob')
  await expect(page.getByRole('region', { name: 'Pinned folders' })).toHaveCount(0)
})
