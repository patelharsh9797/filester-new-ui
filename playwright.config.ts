import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run the real app (vite preview = the Cloudflare Worker in workerd)
// against two local stand-ins: tests/mock/filester-mock.mjs for Filester and
// moto for the user's R2 bucket. Nothing here touches a real account or bucket.
//
//   npm run build:test && npm run test:e2e
//
// moto: `pip install "moto[server]"` (the command is MOTO_CMD, default `moto_server`).
// A browser that isn't Playwright's own can be used with PW_CHROMIUM_PATH.
const PREVIEW = 4173
const reuse = !process.env.CI

export default defineConfig({
  testDir: 'tests/e2e',
  // Every spec resets the shared mock, so run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW}`,
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    { command: 'node tests/mock/filester-mock.mjs', url: 'http://127.0.0.1:8899/__state', reuseExistingServer: reuse },
    { command: `${process.env.MOTO_CMD || 'moto_server'} -H 127.0.0.1 -p 5055`, url: 'http://127.0.0.1:5055/moto-api/', reuseExistingServer: reuse },
    {
      command: `npx vite preview --host 127.0.0.1 --port ${PREVIEW} --strictPort`,
      url: `http://127.0.0.1:${PREVIEW}/login`,
      env: { FSNAV_WRANGLER_CONFIG: 'tests/e2e/wrangler.test.jsonc' },
      reuseExistingServer: reuse,
      timeout: 60_000,
    },
  ],
})
