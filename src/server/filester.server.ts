// Talks to filester.me on behalf of the signed-in user.
//
// Filester only allows CORS from https://filester.me, so the browser can't call
// it directly. Requests come to /api/fs/* on this app and are forwarded here
// with the user's credentials (from the encrypted session cookie) attached.

import { env } from 'cloudflare:workers'

/**
 * Upstream origins. Override with the FILESTER_WEB_ORIGIN / FILESTER_API_ORIGIN
 * vars (e.g. to use a Filester mirror domain); read per request as Workers require.
 */
export function filesterOrigins() {
  const e = env as unknown as Record<string, string | undefined>
  return {
    WEB: (e.FILESTER_WEB_ORIGIN || 'https://filester.me').replace(/\/$/, ''),
    U1: (e.FILESTER_API_ORIGIN || 'https://u1.filester.me').replace(/\/$/, ''),
  }
}
export const UA = 'Mozilla/5.0 (compatible; FilesterNavigator/1.0; personal file manager)'

/** Prefix after /api/fs/ → upstream base + which credential to attach. */
function routes(): Record<string, { base: string; auth: 'key' | 'cookie' }> {
  const { WEB, U1 } = filesterOrigins()
  return {
    v1: { base: `${U1}/api/v1/`, auth: 'key' },
    v2: { base: `${U1}/api/v2/`, auth: 'key' },
    u1: { base: `${U1}/`, auth: 'key' },
    web: { base: `${WEB}/api/`, auth: 'cookie' },
  }
}

const FORWARD_REQ = ['content-type', 'content-length', 'x-upload-id', 'x-chunk-index', 'x-folder-id', 'accept']
const FORWARD_RES = ['content-type', 'content-disposition', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']

export async function proxy(request: Request, splat: string, creds: { token: string; apiKey: string }): Promise<Response> {
  const slash = splat.indexOf('/')
  const prefix = slash === -1 ? splat : splat.slice(0, slash)
  const route = routes()[prefix]
  if (!route || slash === -1) return Response.json({ success: false, message: 'Unknown route' }, { status: 404 })

  const rest = splat.slice(slash + 1)
  // Guard against path tricks escaping the upstream base.
  if (rest.split('/').some((seg) => seg === '..' || seg === '.')) return Response.json({ success: false, message: 'Bad path' }, { status: 400 })
  const url = new URL(request.url)
  const target = route.base + rest + url.search

  const headers = new Headers({ 'user-agent': UA })
  for (const h of FORWARD_REQ) {
    const v = request.headers.get(h)
    if (v) headers.set(h, v)
  }
  if (route.auth === 'key') headers.set('authorization', `Bearer ${creds.apiKey}`)
  else headers.set('cookie', `auth_token=${creds.token}`)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
  })

  const out = new Headers({ 'cache-control': 'private, no-store' })
  for (const h of FORWARD_RES) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export type LoginResult =
  | { ok: true; token: string; apiKey: string }
  | { ok: false; requires2fa?: boolean; message: string; status: number }

export async function filesterLogin(username: string, password: string, code?: string): Promise<LoginResult> {
  const { WEB } = filesterOrigins()
  const r = await fetch(`${WEB}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify(code ? { username, password, code } : { username, password }),
  })
  const data = (await r.json().catch(() => ({}))) as { success?: boolean; requires_2fa?: boolean; message?: string; token?: string }
  if (data.requires_2fa) return { ok: false, requires2fa: true, message: 'Enter your 2FA or backup code', status: 200 }
  if (!r.ok || !data.success) {
    const blocked = r.status === 403 && !data.message
    return {
      ok: false,
      status: r.status,
      message: data.message || (blocked ? 'Filester blocked the request from this server (DDoS protection).' : `Login failed (${r.status})`),
    }
  }
  let token = data.token ?? ''
  if (!token) {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const m = /^auth_token=([^;]+)/.exec(c)
      if (m?.[1]) token = m[1]
    }
  }
  if (!token) return { ok: false, status: 502, message: 'Login succeeded but Filester returned no session token' }
  const apiKey = await fetchApiKey(token).catch(() => '')
  return { ok: true, token, apiKey }
}

async function fetchApiKey(token: string): Promise<string> {
  const { WEB } = filesterOrigins()
  const r = await fetch(`${WEB}/account`, { headers: { cookie: `auth_token=${token}`, 'user-agent': UA } })
  const html = await r.text()
  const m = /id="apiKeyValue"[^>]*>\s*([^<\s]+)\s*</.exec(html)
  return m ? m[1] : ''
}

/** Quick check that an API key works. */
export async function verifyApiKey(apiKey: string): Promise<boolean> {
  const { U1 } = filesterOrigins()
  const r = await fetch(`${U1}/api/v1/account`, { headers: { authorization: `Bearer ${apiKey}`, 'user-agent': UA } })
  return r.ok
}
