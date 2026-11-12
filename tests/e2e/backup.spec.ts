import type { Page } from '@playwright/test'
import crypto from 'node:crypto'
import { test, expect, fakeTurnstile, resetAll, signIn, makeBucket, bucketKeys, readObject, mockState, MOCK } from './helpers'
// @ts-expect-error plain JS helper shared with the mock server
import { contentFor } from '../mock/content.mjs'

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const AT_RISK = ['take-five.mp3', 'tokyo-night.jpg', 'big-12mb.bin']

test.beforeEach(async ({ request }) => {
  await resetAll(request)
  // Pretend three files were last downloaded 33 days ago: 2 days left under the 35-day rule.
  expect((await request.post(`${MOCK}/__age`, { data: { days: 33, names: AT_RISK } })).ok()).toBe(true)
})

async function connect(page: Page, bucket: string, accountId = '0123456789abcdef0123456789abcdef') {
  await page.goto('/backups')
  await page.getByPlaceholder('32-character id').fill(accountId)
  await page.getByPlaceholder('filester-backups').fill(bucket)
  await page.getByLabel('Access Key ID').fill('AKIDTESTONLY0000')
  await page.getByLabel('Secret Access Key').fill('test-secret-key-not-real-000000000000000')
  await page.getByRole('button', { name: 'Test & connect' }).click()
}

test('expiring page flags files about to be deleted', async ({ page }) => {
  await signIn(page)
  await page.goto('/expiring')
  const card = page.getByRole('button', { name: /Within 3 days/ })
  await expect(card).toContainText('3')
  await card.click()
  await expect(page.locator('tbody tr')).toHaveCount(3)
  for (const n of AT_RISK) await expect(page.locator('tbody')).toContainText(n)
  await expect(page.getByText('Want a safety copy?')).toBeVisible()
})

test('a bucket that does not exist is rejected with a clear error', async ({ page }) => {
  await signIn(page)
  await connect(page, 'no-such-bucket')
  await expect(page.locator('form .text-danger')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Backups are on' })).toHaveCount(0)
})

test('back up at-risk files into the user’s own bucket (incl. multipart), isolated per user', async ({ page, browser, request }) => {
  await makeBucket(request, 'alice-backups')
  await signIn(page)
  await connect(page, 'alice-backups')
  await expect(page.getByText('Bucket connected — backups are on')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Backups are on' })).toBeVisible()

  await page.goto('/expiring?within=3')
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await page.getByRole('button', { name: 'Back up to R2' }).click()
  await expect.poll(() => bucketKeys(request, 'alice-backups'), { timeout: 30_000 }).toHaveLength(3)

  const keys = await bucketKeys(request, 'alice-backups')
  expect(keys.every((k) => k.startsWith('filester-navigator/'))).toBe(true)
  // Byte-for-byte copies, including the 12 MB file sent as 5 MB parts.
  const files = (await mockState(request)).files
  for (const name of AT_RISK) {
    const key = keys.find((k) => k.endsWith(`/${name}`))
    expect(key, name).toBeTruthy()
    const body = await readObject('alice-backups', key!)
    const size = files.find((f) => f.name === name)!.size
    expect(body.length, name).toBe(size)
    expect(sha(body), name).toBe(sha(contentFor(name, size)))
  }
  await page.goto('/backups')
  await expect(page.getByText('Today’s backup allowance')).toBeVisible()
  for (const n of AT_RISK) await expect(page.locator('main')).toContainText(n)

  // Another Filester user on the same deployment sees none of this.
  const bobCtx = await browser.newContext()
  await fakeTurnstile(bobCtx)
  const bob = await bobCtx.newPage()
  await signIn(bob, 'bob')
  await bob.goto('/backups')
  await expect(bob.getByText('Turn on backups with your own R2 bucket')).toBeVisible()
  const res = await bob.request.get('/api/backup/list')
  expect(res.status()).toBeGreaterThanOrEqual(400)
  await bobCtx.close()
})
