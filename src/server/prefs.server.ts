// Pinned folders and saved searches, synced across a user's devices (opt-in).
// Stored encrypted per Filester user (see putSealed); validated strictly so the
// record stays small and only holds what the sidebar needs.
import { env } from 'cloudflare:workers'
import { ConfigError, getSealed, putSealed } from './r2config.server'

export interface SyncedPrefs {
  folders: string[]
  searches: { id: string; name: string; page: '/files' | '/folders' | '/expiring'; search: Record<string, string>; createdAt: string }[]
  /** ms since epoch of the last change, set by the device that made it */
  updatedAt: number
  /** New each time sync is turned on; a browser merges its own pins once per id */
  syncId: string
}

const PAGES = new Set(['/files', '/folders', '/expiring'])
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const KEY_RE = /^[a-z]{1,16}$/
export const MAX_PREFS_BYTES = 64 * 1024

const kvKey = (userId: number) => `prefs:${userId}`

/** Validate and normalize what a browser sends; throws ConfigError on anything unexpected. */
export function parsePrefs(input: unknown): SyncedPrefs {
  const o = (input ?? {}) as Record<string, unknown>
  if (!Array.isArray(o.folders) || !Array.isArray(o.searches)) throw new ConfigError('Expected folders and searches')
  if (o.folders.length > 500 || o.searches.length > 200) throw new ConfigError('Too many pins or saved searches')
  const folders = [...new Set(o.folders.filter((f): f is string => typeof f === 'string' && ID_RE.test(f)))]
  const searches = o.searches.flatMap((raw) => {
    const s = (raw ?? {}) as Record<string, unknown>
    if (typeof s.id !== 'string' || !ID_RE.test(s.id) || typeof s.name !== 'string' || !PAGES.has(s.page as string)) return []
    const search: Record<string, string> = {}
    for (const [k, v] of Object.entries((s.search ?? {}) as Record<string, unknown>).slice(0, 12)) {
      if (KEY_RE.test(k) && typeof v === 'string' && v.length <= 200) search[k] = v
    }
    return [{ id: s.id, name: s.name.trim().slice(0, 60) || 'Saved search', page: s.page as SyncedPrefs['searches'][number]['page'], search, createdAt: typeof s.createdAt === 'string' ? s.createdAt.slice(0, 40) : '' }]
  })
  const updatedAt = Number(o.updatedAt)
  const syncId = typeof o.syncId === 'string' && ID_RE.test(o.syncId) ? o.syncId : crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const prefs = { folders, searches, updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.min(updatedAt, Date.now() + 60_000) : Date.now(), syncId }
  if (JSON.stringify(prefs).length > MAX_PREFS_BYTES) throw new ConfigError('Too much to sync')
  return prefs
}

export const loadPrefs = (userId: number) => getSealed<SyncedPrefs>(kvKey(userId), 'prefs', userId)
export const savePrefs = (userId: number, p: SyncedPrefs) => putSealed(kvKey(userId), 'prefs', userId, p)
export const deletePrefs = (userId: number) => env.STORE.delete(kvKey(userId))
