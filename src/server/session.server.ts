// Encrypted session cookie.
//
// The cookie holds the Filester session JWT and API key, encrypted with
// AES-GCM using SESSION_SECRET. It is HttpOnly (page scripts can't read it),
// Secure and SameSite=Lax. Nothing is stored server-side.
import { env } from 'cloudflare:workers'
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

export interface Session {
  username: string
  /** Filester's numeric user id (stable even if the username changes); keys per-user data */
  userId?: number
  /** Filester session JWT (web endpoints: rename, folder edit, info) */
  token: string
  /** Filester API key (documented REST API) */
  apiKey: string
  /** Expiry, seconds since epoch */
  exp: number
}

const COOKIE = '__Host-fsnav'
const DEFAULT_TTL = 30 * 24 * 3600

const cookieOptions = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const

let keyCache: { secret: string; key: Promise<CryptoKey> } | null = null
function getKey(): Promise<CryptoKey> {
  const secret = env.SESSION_SECRET
  if (!secret || secret.length < 16) throw new Error('SESSION_SECRET is not set (min 16 chars). Run: npx wrangler secret put SESSION_SECRET')
  if (keyCache?.secret === secret) return keyCache.key
  const key = crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(secret))
    .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
  keyCache = { secret, key }
  return key
}

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function seal(data: Session): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(JSON.stringify(data)))
  return `${b64(iv)}.${b64(ct)}`
}

async function unseal(value: string): Promise<Session | null> {
  try {
    const [iv, ct] = value.split('.')
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await getKey(), unb64(ct))
    const s = JSON.parse(new TextDecoder().decode(pt)) as Session
    return s.exp * 1000 > Date.now() ? s : null
  } catch {
    return null
  }
}

/** Expiry from the Filester JWT, if readable. */
export function jwtExpiry(token: string): number {
  try {
    const p = JSON.parse(new TextDecoder().decode(unb64(token.split('.')[1])))
    if (typeof p.exp === 'number') return p.exp
  } catch { /* fall through */ }
  return Math.floor(Date.now() / 1000) + DEFAULT_TTL
}

/**
 * Optional sign-in allowlist from the ALLOWED_USERS secret (comma- or space-separated
 * Filester usernames, case-insensitive). Unset or empty = the app is public.
 */
export function allowedUsers(): Set<string> {
  const raw = (env as unknown as Record<string, string | undefined>).ALLOWED_USERS ?? ''
  return new Set(raw.split(/[\s,]+/).map((u) => u.trim().toLowerCase()).filter(Boolean))
}

export function isAllowedUser(username: string) {
  const list = allowedUsers()
  return list.size === 0 || list.has(username.trim().toLowerCase())
}

/** The signed-in user — only if they're still on the allowlist (removing someone signs them out). */
export async function readSession(): Promise<Session | null> {
  const raw = getCookie(COOKIE)
  const s = raw ? await unseal(raw) : null
  return s && isAllowedUser(s.username) ? s : null
}

export async function writeSession(s: Session) {
  setCookie(COOKIE, await seal(s), { ...cookieOptions, maxAge: Math.max(60, s.exp - Math.floor(Date.now() / 1000)) })
}

export function clearSession() {
  deleteCookie(COOKIE, cookieOptions)
}
