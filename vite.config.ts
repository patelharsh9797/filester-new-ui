import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { port: 3000 },
  resolve: { tsconfigPaths: true },
  plugins: [
    // FSNAV_WRANGLER_CONFIG lets the e2e tests use tests/e2e/wrangler.test.jsonc (and its .dev.vars).
    cloudflare({ viteEnvironment: { name: 'ssr' }, configPath: process.env.FSNAV_WRANGLER_CONFIG }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
})
