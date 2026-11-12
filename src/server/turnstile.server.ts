// Optional Cloudflare Turnstile on the sign-in form (bot protection for a public deploy).
// Off unless both TURNSTILE_SITE_KEY (var) and TURNSTILE_SECRET (secret) are set.
import { env } from 'cloudflare:workers'
import { getRequestHeader } from '@tanstack/react-start/server'

const vars = () => env as unknown as Record<string, string | undefined>

/** Public site key for the widget, or null when Turnstile is off. */
export function turnstileSiteKey(): string | null {
  const v = vars()
  return v.TURNSTILE_SITE_KEY && v.TURNSTILE_SECRET ? v.TURNSTILE_SITE_KEY : null
}

/** Verify a widget token with Cloudflare. Tokens are single-use and expire after 5 minutes. */
export async function verifyTurnstile(token: string | undefined): Promise<{ ok: true } | { ok: false; message: string }> {
  const v = vars()
  if (!turnstileSiteKey()) return { ok: true }
  if (!token) return { ok: false, message: 'Please complete the “verify you are human” check.' }
  const body = new FormData()
  body.set('secret', v.TURNSTILE_SECRET!)
  body.set('response', token)
  const ip = getRequestHeader('cf-connecting-ip')
  if (ip) body.set('remoteip', ip)
  try {
    // TURNSTILE_VERIFY_URL is for tests only.
    const r = await fetch(v.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body })
    const j = (await r.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (j.success) return { ok: true }
    const expired = j['error-codes']?.includes('timeout-or-duplicate')
    return { ok: false, message: expired ? 'The human check expired — please try again.' : 'The human check failed — please try again.' }
  } catch {
    return { ok: false, message: 'Couldn’t reach the human-check service — please try again.' }
  }
}
