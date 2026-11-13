import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { parseCredentials, parseSettings, maskConfig, saveConfig, loadConfig, getUsage, addUsage, nextReset, untilReset, type R2Config } from '../../src/server/r2config.server'
import { rfc3986, encKey } from '../../src/server/s3.server'
import { safeName, keyFor, parseKey, isBackupKey, PREFIX } from '../../src/server/backup.server'
import { isAllowedUser } from '../../src/server/session.server'

const vars = env as unknown as Record<string, string | undefined>
const kv = (env as unknown as { STORE: { data: Map<string, string> } }).STORE
const cfg: R2Config = {
  accountId: '0123456789abcdef0123456789abcdef', bucket: 'my-backups', accessKeyId: 'AKIDEXAMPLE12345678',
  secretAccessKey: 'secret-secret-secret-secret', retentionDays: 30, limitGb: 10, connectedAt: '2025-01-01T00:00:00Z',
}

beforeEach(() => kv.data.clear())

describe('R2 settings', () => {
  it('validates credentials', () => {
    expect(parseCredentials({ accountId: ' 0123456789ABCDEF0123456789ABCDEF ', bucket: 'My-Bucket', accessKeyId: 'AKIDEXAMPLE12345678', secretAccessKey: 'abcdefghijklmnopqrstuvwxyz' }))
      .toMatchObject({ accountId: '0123456789abcdef0123456789abcdef', bucket: 'my-bucket' })
    expect(() => parseCredentials({ ...cfg, accountId: 'xyz' })).toThrow(/Account ID/)
    expect(() => parseCredentials({ ...cfg, bucket: '-bad' })).toThrow(/Bucket name/)
    expect(() => parseCredentials({ ...cfg, secretAccessKey: 'short' })).toThrow(/Secret/)
  })
  it('validates settings', () => {
    expect(parseSettings({ retentionDays: '7', limitGb: '2.25' })).toEqual({ retentionDays: 7, limitGb: 2.3 })
    expect(() => parseSettings({ retentionDays: 0, limitGb: 1 })).toThrow()
  })
  it('never exposes the secret', () => {
    const v = maskConfig(cfg)
    expect(JSON.stringify(v)).not.toContain(cfg.secretAccessKey)
    expect(v.accessKeyHint).toBe('AKID…5678')
  })
  it('stores settings encrypted and bound to the user id', async () => {
    await saveConfig(7, cfg)
    const raw = kv.data.get('r2:7')!
    expect(raw).not.toContain(cfg.secretAccessKey)
    expect(raw).not.toContain(cfg.bucket)
    expect(await loadConfig(7)).toEqual(cfg)
    // Copying the blob onto another user's record must not decrypt.
    kv.data.set('r2:8', raw)
    expect(await loadConfig(8)).toBeNull()
    expect(await loadConfig(9)).toBeNull()
  })
})

describe('daily usage', () => {
  it('counts per user and reports the cap', async () => {
    await addUsage(1, 300 * 1024 ** 2)
    await addUsage(1, 200 * 1024 ** 2)
    await addUsage(2, 5)
    const u = await getUsage(1)
    expect(u.used).toBe(500 * 1024 ** 2)
    expect(u.cap).toBe(1024 ** 3)
    expect(u.remaining).toBe(524 * 1024 ** 2)
    expect((await getUsage(2)).used).toBe(5)
  })
  it('resets at the next UTC midnight', () => {
    const d = new Date('2025-03-10T22:30:00Z')
    expect(nextReset(d).toISOString()).toBe('2025-03-11T00:00:00.000Z')
    expect(untilReset(d)).toBe('1h 30m')
  })
})

describe('S3 keys', () => {
  it('encodes RFC 3986 reserved characters SigV4 needs', () => {
    expect(rfc3986("a (1)!'*.jpg")).toBe('a%20%281%29%21%27%2A.jpg')
    expect(encKey('filester-navigator/ab c/x+y.jpg')).toBe('filester-navigator/ab%20c/x%2By.jpg')
  })
})

describe('backup keys', () => {
  it('keeps names as one safe path segment', () => {
    expect(safeName('a/b\\c\u0001.txt')).toBe('a_b_c_.txt')
    expect(safeName('')).toBe('file')
    expect(safeName('x'.repeat(300))).toHaveLength(200)
  })
  it('round-trips slug and name', () => {
    const k = keyFor('Ab12', 'my photo (1).jpg')
    expect(k).toBe(`${PREFIX}Ab12/my photo (1).jpg`)
    expect(parseKey(k)).toEqual({ slug: 'Ab12', name: 'my photo (1).jpg' })
  })
  it('only accepts keys under the app prefix', () => {
    expect(isBackupKey(`${PREFIX}x/y`)).toBe(true)
    expect(isBackupKey('other/x')).toBe(false)
    expect(isBackupKey(`${PREFIX}../secret`)).toBe(false)
  })
})

describe('allowlist', () => {
  it('is public when ALLOWED_USERS is empty', () => {
    delete vars.ALLOWED_USERS
    expect(isAllowedUser('anyone')).toBe(true)
  })
  it('restricts to listed users (case-insensitive)', () => {
    vars.ALLOWED_USERS = 'Alice, bob'
    expect(isAllowedUser('alice')).toBe(true)
    expect(isAllowedUser('BOB')).toBe(true)
    expect(isAllowedUser('mallory')).toBe(false)
    delete vars.ALLOWED_USERS
  })
})

describe('synced prefs', async () => {
  const { parsePrefs, savePrefs, loadPrefs } = await import('../../src/server/prefs.server')
  it('keeps only valid pins and searches', () => {
    const p = parsePrefs({
      folders: ['abc123', 'abc123', '../etc', 42],
      searches: [
        { id: 's1', name: '  Photos  ', page: '/files', search: { q: 'jpg', kind: 'image', 'Bad-Key': 'x', long: 'y'.repeat(300) }, createdAt: '2025' },
        { id: 's2', name: 'x', page: '/evil', search: {} },
      ],
      updatedAt: 123,
    })
    expect(p.folders).toEqual(['abc123'])
    expect(p.searches).toEqual([{ id: 's1', name: 'Photos', page: '/files', search: { q: 'jpg', kind: 'image' }, createdAt: '2025' }])
    expect(p.updatedAt).toBe(123)
    expect(p.syncId).toMatch(/^[a-f0-9]{16}$/)
  })
  it('rejects malformed or oversized input', () => {
    expect(() => parsePrefs({})).toThrow()
    expect(() => parsePrefs({ folders: Array(501).fill('a'), searches: [] })).toThrow(/Too many/)
  })
  it('is stored encrypted, only readable by the same user, and not as R2 settings', async () => {
    await savePrefs(5, { folders: ['secretfolder'], searches: [], updatedAt: 1, syncId: 'abc' })
    const raw = kv.data.get('prefs:5')!
    expect(raw).not.toContain('secretfolder')
    expect((await loadPrefs(5))?.folders).toEqual(['secretfolder'])
    kv.data.set('prefs:6', raw)
    expect(await loadPrefs(6)).toBeNull()
    kv.data.set('r2:5', raw)
    expect(await loadConfig(5)).toBeNull()
  })
})
