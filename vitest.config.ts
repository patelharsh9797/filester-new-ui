import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Unit tests for pure logic. `cloudflare:workers` is replaced by a small stub with an
// in-memory KV so server modules can be imported under Node.
export default defineConfig({
  resolve: {
    alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/unit/cf-stub.ts', import.meta.url)) },
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
})
