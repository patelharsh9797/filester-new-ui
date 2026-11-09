// Each user's own R2 backup settings, stored encrypted in KV.
//
// - Encrypted with AES-GCM using a key derived from CREDENTIALS_SECRET (separate
//   from the session secret), with the user's id as additional authenticated data:
//   a blob copied onto another user's record fails to decrypt.
// - The secret access key is never returned to the browser (see maskConfig).
import { env } from 'cloudflare:workers'
import type { Session } from './session.server'
import { filesterUserId } from './filester.server'

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** Delete backups older than this many days */
  retentionDays: number
  /** Refuse new backups once the user's backups exceed this many GB */
  limitGb: number
  connectedAt: string
}

/** What the browser is allowed to see. */
export interface R2ConfigView {
  accountId: string
  bucket: string
  accessKeyHint: string
  retentionDays: number
  limitGb: number
  connectedAt: string
}

export const ACCOUNT_ID_RE = /^[0-9a-f]{32}$/
// R2 bucket names: 3-63 chars, lowercase letters, digits and hyphens, not starting/ending with a hyphen.
export const BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/
const KEY_ID_RE = /^[A-Za-z0-9]{16,128}$/
const SECRET_RE = /^[A-Za-z0-9+/=_-]{16,256}$/

export class ConfigError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

/** Validate user-entered credentials (format only; connect() then tests them for real). */
export function parseCredentials(input: Record<string, unknown>) {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const accountId = s(input.accountId).toLowerCase()
  const accessKeyId = s(input.accessKeyId)
  const secretAccessKey = s(input.secretAccessKey)
  const bucket = s(input.bucket).toLowerCase()
  if (!ACCOUNT_ID_RE.test(accountId)) throw new ConfigError('Account ID should be 32 characters (0-9, a-f). Find it on the R2 overview page.')
  if (!BUCKET_RE.test(bucket)) throw new ConfigError('Bucket name should be 3–63 lowercase letters, digits or hyphens.')
  if (!KEY_ID_RE.test(accessKeyId)) throw new ConfigError('That Access Key ID doesn’t look right — copy it from the R2 API token page.')
  if (!SECRET_RE.test(secretAccessKey)) throw new ConfigError('That Secret Access Key doesn’t look right — copy it from the R2 API token page.')
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

export function parseSettings(input: Record<string, unknown>) {
  const retentionDays = Math.round(Number(input.retentionDays))
  const limitGb = Number(input.limitGb)
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new ConfigError('Keep backups for 1–365 days.')
  if (!Number.isFinite(limitGb) || limitGb < 0.1 || limitGb > 10_000) throw new ConfigError('Size limit should be between 0.1 and 10,000 GB.')
  return { retentionDays, limitGb: Math.round(limitGb * 10) / 10 }
}

export function maskConfig(c: R2Config): R2ConfigView {
  return {
    accountId: c.accountId,
    bucket: c.bucket,
    accessKeyHint: `${c.accessKeyId.slice(0, 4)}…${c.accessKeyId.slice(-4)}`,
    retentionDays: c.retentionDays,
    limitGb: c.limitGb,
    connectedAt: c.connectedAt,
  }
}

// ---------------------------------------------------------------- user id

/** The user's Filester id (in the session since this feature; looked up for older sessions). */
export async function userIdOf(session: Session): Promise<number> {
  if (typeof session.userId === 'number') return session.userId
  return filesterUserId(session.apiKey)
}

// ---------------------------------------------------------------- crypto

let keyCache: { secret: string; key: Promise<CryptoKey> } | null = null
function getKey(): Promise<CryptoKey> {
  const secret = (env as unknown as Record<string, string | undefined>).CREDENTIALS_SECRET
  if (!secret || secret.length < 16) throw new ConfigError('Backups are not available: the app owner hasn’t set CREDENTIALS_SECRET.', 503)
  if (keyCache?.secret === secret) return keyCache.key
  const key = crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(`fsnav-credentials:${secret}`))
    .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
  keyCache = { secret, key }
  return key
}

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const aad = (userId: number) => new TextEncoder().encode(`fsnav:r2:${userId}`)
const kvKey = (userId: number) => `r2:${userId}`

export async function saveConfig(userId: number, c: R2Config) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId) }, await getKey(), new TextEncoder().encode(JSON.stringify(c)))
  await env.STORE.put(kvKey(userId), JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }))
}

export async function loadConfig(userId: number): Promise<R2Config | null> {
  const raw = await env.STORE.get(kvKey(userId))
  if (!raw) return null
  try {
    const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string }
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: aad(userId) }, await getKey(), unb64(ct))
    return JSON.parse(new TextDecoder().decode(pt)) as R2Config
  } catch (e) {
    if (e instanceof ConfigError) throw e
    // Wrong secret (rotated) or tampered record: treat as not connected.
    return null
  }
}

export async function deleteConfig(userId: number) {
  await env.STORE.delete(kvKey(userId))
}

// ---------------------------------------------------------------- daily cap

/** Bytes this user may still copy today (Infinity when there's no cap). */
export async function remainingToday(userId: number): Promise<number> {
  const capGb = Number((env as unknown as Record<string, string | undefined>).BACKUP_DAILY_CAP_GB ?? 50)
  if (!capGb || capGb <= 0) return Infinity
  const used = Number(await env.STORE.get(`usage:${userId}:${new Date().toISOString().slice(0, 10)}`)) || 0
  return capGb * 1024 ** 3 - used
}

/** Record bytes copied today (approximate under concurrency, which is fine for a fair-use cap). */
export async function addUsage(userId: number, bytes: number) {
  const key = `usage:${userId}:${new Date().toISOString().slice(0, 10)}`
  const used = Number(await env.STORE.get(key)) || 0
  await env.STORE.put(key, String(used + bytes), { expirationTtl: 2 * 86_400 })
}
