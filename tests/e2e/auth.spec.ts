import { test, expect, resetAll, signIn, mockState, MOCK } from './helpers'

test.beforeEach(async ({ request }) => resetAll(request))

test('wrong password shows Filester’s message', async ({ page }) => {
  await page.goto('/login')
  await page.fill('#u', 'alice')
  await page.fill('#p', 'nope')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Invalid username or password')).toBeVisible()
})

test('password toggle and signup link', async ({ page }) => {
  await page.goto('/login')
  await page.fill('#p', 'secret')
  await expect(page.locator('#p')).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show password' }).click()
  await expect(page.locator('#p')).toHaveAttribute('type', 'text')
  await expect(page.getByRole('link', { name: /create one|sign up/i })).toHaveAttribute('href', /filester\.me/)
})

test('sign in, see overview, sign out', async ({ page }) => {
  await signIn(page)
  await expect(page.getByText('alice').first()).toBeVisible()
  // Pages behind login redirect back to /login once signed out.
  await page.goto('/settings')
  await page.getByRole('button', { name: /sign out/i }).first().click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('#u')).toBeVisible()
  await page.goto('/files')
  await expect(page).toHaveURL(/\/login/)
})

test.describe('Turnstile (enabled in the test deploy)', () => {
  test('sign-in waits for the human check', async ({ page }) => {
    await page.route('https://challenges.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.turnstile={render(){return "w"},reset(){},remove(){}}' }))
    await page.goto('/login')
    await page.fill('#u', 'alice')
    await page.fill('#p', 'alice-pass-123')
    await expect(page.getByTestId('turnstile')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  test('a failed human check stops sign-in before Filester is contacted', async ({ page, request }) => {
    expect((await request.post(`${MOCK}/__break`, { data: { what: 'turnstile' } })).ok()).toBe(true)
    await page.goto('/login')
    await page.fill('#u', 'alice')
    await page.fill('#p', 'alice-pass-123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('The human check failed — please try again.')).toBeVisible()
    expect((await mockState(request)).logins).toBe(0)
  })

  test('a retry after a wrong password gets a fresh token', async ({ page, request }) => {
    await page.goto('/login')
    await page.fill('#u', 'alice')
    await page.fill('#p', 'wrong')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Invalid username or password')).toBeVisible()
    await page.fill('#p', 'alice-pass-123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Recent uploads')).toBeVisible()
    expect((await mockState(request)).logins).toBe(2)
  })
})

test('privacy note on sign-in expands to the full details, and is in Settings', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('Your password goes to filester.me once and is never stored.')).toBeVisible()
  await expect(page.getByText('What’s stored on this site’s server')).toHaveCount(0)
  await page.getByText('What’s stored?').click()
  await expect(page.getByText(/Never stored here: your files, your password, or your file list/)).toBeVisible()
  await expect(page.getByText(/Cloudflare Turnstile checks your browser/)).toBeVisible()

  await signIn(page)
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeVisible()
  await expect(page.getByText(/only if you turn on backups/)).toBeVisible()
})
