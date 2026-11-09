import { createServerFn } from '@tanstack/react-start'
import { allowedUsers, clearSession, isAllowedUser, jwtExpiry, readSession, writeSession } from './session.server'
import { filesterLogin, verifyApiKey } from './filester.server'

/** Who is signed in (never returns the token or API key to the browser). */
export const getSession = createServerFn({ method: 'GET' }).handler(async () => {
  const s = await readSession()
  return s ? { username: s.username, exp: s.exp } : null
})

export type LoginResponse =
  | { status: 'ok'; username: string }
  | { status: 'needs-2fa' }
  | { status: 'needs-api-key' }
  | { status: 'error'; message: string }

export const login = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const d = (input ?? {}) as Record<string, unknown>
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
    const username = str(d.username, 64).trim()
    const password = str(d.password, 256)
    if (!username || !password) throw new Error('Username and password are required')
    return { username, password, code: str(d.code, 16).trim() || undefined, apiKey: str(d.apiKey, 128).trim() || undefined }
  })
  .handler(async ({ data }): Promise<LoginResponse> => {
    // Personal deployment: refuse anyone not on the allowlist *before* their
    // password is sent anywhere.
    if (allowedUsers().size === 0) {
      return { status: 'error', message: 'This app has no allowed users yet. The owner needs to set ALLOWED_USERS (see docs/DEPLOY.md).' }
    }
    if (!isAllowedUser(data.username)) {
      return { status: 'error', message: 'This is a private app. Your Filester account isn’t allowed to sign in here.' }
    }
    const r = await filesterLogin(data.username, data.password, data.code)
    if (!r.ok) return r.requires2fa ? { status: 'needs-2fa' } : { status: 'error', message: r.message }

    let apiKey = r.apiKey
    if (!apiKey && data.apiKey) {
      if (!(await verifyApiKey(data.apiKey))) return { status: 'error', message: 'That API key was rejected by Filester' }
      apiKey = data.apiKey
    }
    if (!apiKey) return { status: 'needs-api-key' }

    await writeSession({ username: data.username, token: r.token, apiKey, exp: jwtExpiry(r.token) })
    return { status: 'ok', username: data.username }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  clearSession()
  return { ok: true }
})
