import { test as base, expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test'
import { AwsClient } from 'aws4fetch'

export const MOCK = 'http://127.0.0.1:8899'

// The test deploy has Turnstile on. Instead of Cloudflare's script, pages get this
// stand-in that immediately "passes" with a single-use token the mock accepts.
const FAKE_TURNSTILE = `(() => {
  const tok = () => 'fake-pass-' + Math.random().toString(36).slice(2)
  const widgets = {}
  let n = 0
  window.turnstile = {
    render(el, o) { const id = 'w' + (++n); widgets[id] = o; el.textContent = 'Human check (test stand-in)'; setTimeout(() => o.callback(tok()), 30); return id },
    reset(id) { const o = widgets[id]; if (o) setTimeout(() => o.callback(tok()), 30) },
    remove(id) { delete widgets[id] },
  }
})()`

/** Serve the stand-in Turnstile script to every page in this context. */
export const fakeTurnstile = (context: BrowserContext) =>
  context.route('https://challenges.cloudflare.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_TURNSTILE }))

export const test = base.extend({
  context: async ({ context }, provide) => {
    await fakeTurnstile(context)
    await provide(context)
  },
})
export { expect }
export const MOTO = 'http://127.0.0.1:5055'

export const USERS = {
  alice: { username: 'alice', password: 'alice-pass-123' },
  bob: { username: 'bob', password: 'bob-pass-123' },
} as const

export interface MockState {
  logins: number
  apiKey: string
  folders: { id: string; name: string; parent: string | null; orphan: boolean; public: boolean; hasPassword: boolean; hideRelated: boolean }[]
  files: { slug: string; name: string; folder: string | null; deleted: boolean; size: number; downloads: number; views: number }[]
}

/** Put the fake Filester back to its seed data and empty the fake R2. */
export async function resetAll(request: APIRequestContext) {
  expect((await request.post(`${MOCK}/__reset`)).ok()).toBe(true)
  expect((await request.post(`${MOTO}/moto-api/reset`)).ok()).toBe(true)
}

export async function mockState(request: APIRequestContext, user = 'alice'): Promise<MockState> {
  return (await request.get(`${MOCK}/__state?user=${user}`)).json()
}

export async function signIn(page: Page, who: keyof typeof USERS = 'alice') {
  await page.goto('/login')
  await page.fill('#u', USERS[who].username)
  await page.fill('#p', USERS[who].password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Recent uploads')).toBeVisible()
}

/** Create a bucket in moto and return R2-style settings for it. */
export async function makeBucket(request: APIRequestContext, name: string) {
  expect((await request.put(`${MOTO}/${name}`)).ok()).toBe(true)
  return { accountId: '0123456789abcdef0123456789abcdef', bucket: name, accessKeyId: 'AKIDTESTONLY0000', secretAccessKey: 'test-secret-key-not-real-000000000000000' }
}

export async function bucketKeys(request: APIRequestContext, bucket: string): Promise<string[]> {
  const xml = await (await request.get(`${MOTO}/${bucket}?list-type=2`)).text()
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
}

const s3 = new AwsClient({ accessKeyId: 'AKIDTESTONLY0000', secretAccessKey: 'test-secret-key-not-real-000000000000000', service: 's3', region: 'auto' })

/** Read an object back from the fake bucket (signed, like a real client). */
export async function readObject(bucket: string, key: string): Promise<Buffer> {
  const r = await s3.fetch(`${MOTO}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`)
  expect(r.status, `GET ${key}`).toBe(200)
  return Buffer.from(await r.arrayBuffer())
}
