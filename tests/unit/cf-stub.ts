// Stand-in for the `cloudflare:workers` module in unit tests.
export class MemoryKV {
  data = new Map<string, string>()
  async get(k: string) { return this.data.get(k) ?? null }
  async put(k: string, v: string) { this.data.set(k, v) }
  async delete(k: string) { this.data.delete(k) }
}

export const env: Record<string, unknown> & { STORE: MemoryKV } = {
  STORE: new MemoryKV(),
  CREDENTIALS_SECRET: 'unit-test-credentials-secret-0123456789',
  SESSION_SECRET: 'unit-test-session-secret-0123456789abc',
  BACKUP_DAILY_CAP_GB: '1',
}
