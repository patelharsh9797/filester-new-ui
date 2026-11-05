export interface Session {
  username: string
  /** Session JWT from /auth/login, used for web-only endpoints (rename, info, ...) */
  token: string
  /** API key from Account Settings, used for the documented REST API */
  apiKey: string
}

const KEY = 'filester-navigator.session'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    return s.apiKey ? s : null
  } catch {
    return null
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: session lives for this tab only */
  }
}

/** Decode the JWT expiry (seconds since epoch), if present. */
export function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}
